import logging
import asyncio
import re
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Firewall, UpdateHistory, Alert, Backup
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService
from app.services.email_service import EmailService
from app.services.backup_service import BackupService
from app.services.opnsense_api import (
    extract_firmware_version,
    extract_latest_firmware_version,
    extract_firmware_update_count,
    extract_needs_reboot,
    merge_firmware_info_into_status,
)

logger = logging.getLogger(__name__)


_REQUEST_MARKER_RE = re.compile(r"\*\*\*GOT REQUEST TO ([^*]+?)\*\*\*", re.IGNORECASE)
_DONE_MARKER = "***DONE***"
_ERROR_MARKER = "***ERROR***"
_REBOOT_MARKER = "***REBOOT***"
_INSTALL_KINDS = ("update", "upgrade", "install", "fetch")
_CHECK_KINDS = ("check",)


def _classify_upgrade_log(log_text: str) -> dict:
    """Inspect an OPNsense upgradestatus log tail to determine current job state."""
    if not log_text:
        return {"job_kind": None, "is_done": False, "is_error": False, "is_reboot": False}
    matches = list(_REQUEST_MARKER_RE.finditer(log_text))
    last_marker = matches[-1] if matches else None
    last_marker_pos = last_marker.end() if last_marker else 0
    tail = log_text[last_marker_pos:]
    kind = last_marker.group(1).strip().lower() if last_marker else None
    return {
        "job_kind": kind,
        "is_done": _DONE_MARKER in tail,
        "is_error": _ERROR_MARKER in tail,
        "is_reboot": _REBOOT_MARKER in tail,
    }


class UpdateService:
    """Service for managing firmware updates"""

    @staticmethod
    async def install_updates(
        db: Session,
        firewall: Firewall,
        triggered_by: str = "manual"
    ) -> UpdateHistory:
        """
        Install firmware updates on a firewall

        Args:
            db: Database session
            firewall: Firewall instance
            triggered_by: "manual" or "auto"

        Returns:
            UpdateHistory record
        """
        update_record = UpdateHistory(
            firewall_id=firewall.id,
            triggered_by=triggered_by,
            status="in-progress"
        )

        try:
            # Decrypt API secret
            api_secret = EncryptionService.decrypt(firewall.api_secret)

            # Initialize API client
            api_client = OPNsenseAPI(
                firewall.ip,
                firewall.api_key,
                api_secret,
                firewall.verify_ssl,
                firewall.ssl_cert_path
            )

            # Get current version
            status_before = await api_client.get_firmware_status()
            update_record.version_before = extract_firmware_version(status_before)

            # Ensure update metadata is fresh before deciding which endpoint to
            # call. firmware/check runs asynchronously on OPNsense: immediately
            # after POSTing /firmware/check, /firmware/status may return a
            # transitional payload with empty product_version / status fields
            # until the check completes. We therefore poll briefly and only
            # replace the original snapshot if a populated payload arrives.
            try:
                await api_client.check_firmware_updates()
                refreshed = None
                for _ in range(10):  # up to ~20s
                    await asyncio.sleep(2)
                    try:
                        candidate = await api_client.get_firmware_status()
                    except Exception:
                        continue
                    if not isinstance(candidate, dict):
                        continue
                    cand_status = str(candidate.get("status", "")).lower()
                    cand_version = extract_firmware_version(candidate)
                    # Skip transitional states / empty payloads.
                    if cand_status in ("busy", "running", "pending_check") and not cand_version:
                        continue
                    if cand_version:
                        refreshed = candidate
                        break
                if isinstance(refreshed, dict):
                    status_before = refreshed
                    update_record.version_before = extract_firmware_version(status_before)
            except Exception as e:
                logger.warning(f"firmware/check failed for {firewall.hostname}: {e}")

            # Also fetch /firmware/info — on Business / for major release
            # upgrades, /firmware/status often returns status='none' even
            # when a major release (e.g. 26.x) is available, because that
            # info lives in /firmware/info (with fields like upgrade_major_*).
            # On real-world OPNsense Business payloads the relevant data is
            # nested two levels deep under product.product_check, NOT at the
            # top level — so we extract that sub-dict and merge from there.
            firmware_info: dict = {}
            product_check: dict = {}
            try:
                firmware_info = await api_client.get_firmware_info() or {}
                if isinstance(firmware_info, dict):
                    product = firmware_info.get("product")
                    if isinstance(product, dict):
                        pc = product.get("product_check")
                        if isinstance(pc, dict):
                            product_check = pc
                    try:
                        logger.info(
                            f"firmware/info payload for {firewall.hostname}: "
                            f"top_level_keys={sorted(firmware_info.keys())}; "
                            f"product_check_present={bool(product_check)}; "
                            f"product_check_keys={sorted(product_check.keys()) if product_check else 'n/a'}; "
                            f"pc_raw_status_upgrade_action={product_check.get('status_upgrade_action')!r}; "
                            f"pc_raw_product_version={product_check.get('product_version')!r}; "
                            f"pc_raw_product_target={product_check.get('product_target')!r}; "
                            f"pc_raw_upgrade_major_version={product_check.get('upgrade_major_version')!r}; "
                            f"pc_raw_upgrade_needs_reboot={product_check.get('upgrade_needs_reboot')!r}; "
                            f"pc_raw_upgrade_packages_type={type(product_check.get('upgrade_packages')).__name__}; "
                            f"pc_raw_upgrade_packages_len={len(product_check.get('upgrade_packages')) if isinstance(product_check.get('upgrade_packages'), list) else 'n/a'}; "
                            f"pc_raw_upgrade_sets_type={type(product_check.get('upgrade_sets')).__name__}; "
                            f"pc_raw_upgrade_sets_len={len(product_check.get('upgrade_sets')) if isinstance(product_check.get('upgrade_sets'), list) else 'n/a'}"
                        )
                    except Exception:
                        pass
                    # Merge product_check into status_before so downstream
                    # logic sees the full upgrade picture. Only fill empty /
                    # placeholder values to avoid clobbering data already
                    # set by /firmware/status.
                    if product_check and isinstance(status_before, dict):
                        for k, v in product_check.items():
                            existing = status_before.get(k)
                            if existing in (None, "", "none") and v not in (None, "", "none"):
                                status_before[k] = v
            except Exception as e:
                logger.warning(f"firmware/info failed for {firewall.hostname}: {e}")

            pending_count = extract_firmware_update_count(status_before)
            if pending_count <= 0:
                top_msg = ""
                status_msg = ""
                if isinstance(status_before, dict):
                    top_msg = str(status_before.get("status", "")).strip()
                    status_msg = str(status_before.get("status_msg", "")).strip()
                raise Exception(
                    f"No updates pending on firewall (status={top_msg or 'unknown'}, "
                    f"status_msg={status_msg or 'none'})"
                )
            pending_count_before = pending_count

            # Create pre-update backup
            logger.info(f"Creating pre-update backup for {firewall.hostname}")
            try:
                await BackupService.create_backup(db, firewall, "pre-update")
            except Exception as e:
                logger.warning(f"Pre-update backup failed: {e}")
                # Continue with update anyway

            # Capture pre-trigger upgradestatus log so we can later detect a
            # ***ERROR*** marker that appears AFTER the trigger (vs. one that
            # was already present from a previous run).
            pre_status_value = ""
            pre_log_snapshot = ""
            try:
                pre_st = await api_client.get_upgrade_status()
                pre_status_value = str(pre_st.get("status", "")).lower()
                pre_log_snapshot = str(pre_st.get("log", "") or "")
            except Exception:
                pass

            # Decide which firmware endpoint to use BEFORE triggering. OPNsense
            # exposes two distinct flows that must not be called together:
            #   * /core/firmware/update  → runs `pkg upgrade` for package updates
            #   * /core/firmware/upgrade → package or release upgrade (needs body)
            # /firmware/upgradestatus only reports the LAST job's status, so
            # calling both back-to-back makes the second one mask the first.
            # We pick exactly one based on the top-level "status" field:
            #   status="update"  → /firmware/update with upgrade=all
            #   status="upgrade" → /firmware/upgrade with the right target
            top_status = ""
            status_upgrade_action = ""
            product_version = ""
            product_latest = ""
            upgrade_major_version = ""
            upgrade_packages_count = 0
            upgrade_sets_count = 0

            # Look up a field at the top level, then fall back to a nested
            # "product" dict (OPNsense Business sometimes nests these).
            def _field(key: str) -> str:
                if not isinstance(status_before, dict):
                    return ""
                v = status_before.get(key)
                if isinstance(v, str) and v.strip() and v.strip().lower() != "none":
                    return v.strip()
                product = status_before.get("product")
                if isinstance(product, dict):
                    pv = product.get(key)
                    if isinstance(pv, str) and pv.strip() and pv.strip().lower() != "none":
                        return pv.strip()
                return ""

            if isinstance(status_before, dict):
                # Diagnostic: dump payload structure on first trigger so we can
                # see what shape this specific firewall returns.
                try:
                    logger.info(
                        f"firmware/status payload for {firewall.hostname}: "
                        f"top_level_keys={sorted(status_before.keys())}; "
                        f"product_type={type(status_before.get('product')).__name__}; "
                        f"product_keys={sorted(status_before['product'].keys()) if isinstance(status_before.get('product'), dict) else 'n/a'}; "
                        f"raw_status={status_before.get('status')!r}; "
                        f"raw_status_msg={status_before.get('status_msg')!r}; "
                        f"raw_status_upgrade_action={status_before.get('status_upgrade_action')!r}; "
                        f"raw_product_version={status_before.get('product_version')!r}; "
                        f"raw_product_latest={status_before.get('product_latest')!r}; "
                        f"raw_upgrade_major_version={status_before.get('upgrade_major_version')!r}; "
                        f"raw_upgrade_packages_type={type(status_before.get('upgrade_packages')).__name__}; "
                        f"raw_upgrade_sets_type={type(status_before.get('upgrade_sets')).__name__}"
                    )
                except Exception:
                    pass

                top_status = _field("status").lower()
                status_upgrade_action = _field("status_upgrade_action").lower()
                product_version = _field("product_version")
                product_latest = _field("product_latest")
                upgrade_major_version = _field("upgrade_major_version")
                up_packages = status_before.get("upgrade_packages")
                up_sets = status_before.get("upgrade_sets")
                if isinstance(up_packages, list):
                    upgrade_packages_count = len(up_packages)
                if isinstance(up_sets, list):
                    upgrade_sets_count = len(up_sets)
                # Fall back to extract_firmware_version which already walks nested
                # structures, in case "product_version" lives somewhere else.
                if not product_version:
                    product_version = extract_firmware_version(status_before) or ""
                if not product_latest:
                    product_latest = extract_latest_firmware_version(status_before) or ""

            # Use /firmware/upgrade when either the firewall explicitly signals
            # an upgrade is needed OR we detected a pending major release via
            # /firmware/info (upgrade_major_version / non-empty upgrade_sets).
            use_upgrade = (
                top_status in ("upgrade", "release_update")
                or bool(upgrade_major_version)
                or upgrade_sets_count > 0
            )

            # Determine the value to send as `upgrade=<target>` to /firmware/upgrade.
            # Priority order, based on actual OPNsense /firmware/status payloads:
            #   1. upgrade_major_version (e.g. "26.4") → major release upgrade.
            #      This is the SOLE reliable signal for a major version jump and
            #      MUST take precedence — product_latest only reports the latest
            #      in the current series, not the upgrade target.
            #   2. status_upgrade_action="pkg" → explicit package-only upgrade.
            #   3. status_upgrade_action in {rel,all,maj,min} with product_latest
            #      → release upgrade to product_latest.
            #   4. Fallback to "pkg" (covers patch updates that still go through
            #      /firmware/upgrade because of status="upgrade").
            if upgrade_major_version:
                upgrade_target = upgrade_major_version
            elif status_upgrade_action == "pkg":
                upgrade_target = "pkg"
            elif status_upgrade_action in ("rel", "all", "maj", "min") and product_latest:
                upgrade_target = product_latest
            else:
                upgrade_target = "pkg"

            # Trigger the selected endpoint.
            logger.info(
                f"Triggering firmware/{'upgrade' if use_upgrade else 'update'} on "
                f"{firewall.hostname} (top_status={top_status or 'unknown'}, "
                f"status_upgrade_action={status_upgrade_action or 'none'}, "
                f"product_version={product_version or 'unknown'}, "
                f"product_latest={product_latest or 'unknown'}, "
                f"upgrade_major_version={upgrade_major_version or 'none'}, "
                f"upgrade_packages={upgrade_packages_count}, "
                f"upgrade_sets={upgrade_sets_count}, "
                f"upgrade_target={upgrade_target})"
            )
            triggered = []
            update_response = None
            upgrade_response = None

            if use_upgrade:
                try:
                    upgrade_response = await api_client.upgrade_firmware(target=upgrade_target)
                    triggered.append("upgrade")
                    logger.info(f"firmware/upgrade response on {firewall.hostname}: {upgrade_response}")
                except Exception as e:
                    logger.warning(f"firmware/upgrade failed on {firewall.hostname}: {e}")
                    upgrade_response = f"error: {e}"
                    # Fall back to /update so a misdetected status does not
                    # leave us without any trigger attempt.
                    try:
                        update_response = await api_client.install_updates()
                        triggered.append("update")
                        logger.info(f"firmware/update fallback response on {firewall.hostname}: {update_response}")
                    except Exception as e2:
                        logger.warning(f"firmware/update fallback failed on {firewall.hostname}: {e2}")
                        update_response = f"error: {e2}"
            else:
                try:
                    update_response = await api_client.install_updates()
                    triggered.append("update")
                    logger.info(f"firmware/update response on {firewall.hostname}: {update_response}")
                except Exception as e:
                    logger.warning(f"firmware/update failed on {firewall.hostname}: {e}")
                    update_response = f"error: {e}"

            if not triggered:
                raise Exception("Neither firmware/update nor firmware/upgrade accepted by firewall")

            action = "+".join(triggered)
            update_record.log = (
                f"action={action}; "
                f"top_status={top_status or 'unknown'}; "
                f"status_upgrade_action={status_upgrade_action or 'none'}; "
                f"product_version={product_version or 'unknown'}; "
                f"product_latest={product_latest or 'unknown'}; "
                f"upgrade_major_version={upgrade_major_version or 'none'}; "
                f"upgrade_packages={upgrade_packages_count}; "
                f"upgrade_sets={upgrade_sets_count}; "
                f"upgrade_target={upgrade_target}; "
                f"update_response={update_response}; "
                f"upgrade_response={upgrade_response}; "
                f"pre_status={pre_status_value or 'none'}; "
                f"pre_log_len={len(pre_log_snapshot)}"
            )

            # Give configd time to actually pick up the new job before we start
            # polling.
            await asyncio.sleep(15)

            # Poll for completion by observing the firewall itself: the firmware
            # version string and the pending-update count are the ground truth.
            # We declare success when EITHER:
            #   (a) firmware/status reports a different version than before, OR
            #   (b) the pending-update count dropped to 0 after the trigger.
            # Connection errors are tolerated (firewall may be rebooting). In
            # parallel we still watch upgradestatus for an ***ERROR*** marker
            # that appeared AFTER our trigger so we can fail fast on real
            # errors instead of waiting for the full timeout.
            max_wait = 3600  # 1 hour
            poll_interval = 15
            min_wait_before_done = 30  # do not accept "no pending" within first 30s
            elapsed = 0
            completed = False
            saw_running = False
            successful_polls_after_trigger = 0
            last_observed_version = update_record.version_before
            last_observed_pending = pending_count_before

            while elapsed < max_wait:
                # Watch upgradestatus log for an ERROR marker that appeared
                # AFTER our trigger. Tolerate connection failures (reboot).
                try:
                    st = await api_client.get_upgrade_status()
                    st_log = str(st.get("log", "") or "")
                    info = _classify_upgrade_log(st_log)
                    kind = info["job_kind"] or ""

                    # Mark "running" once we see an install-job marker that is
                    # NOT yet marked done — useful debug signal in the log.
                    if any(k in kind for k in _INSTALL_KINDS) and not info["is_done"]:
                        saw_running = True

                    # ERROR only counts as a real failure if it appeared after
                    # our trigger (i.e. the log differs from the pre-snapshot).
                    if info["is_error"] and st_log != pre_log_snapshot:
                        tail = st_log[-500:]
                        raise Exception(f"OPNsense reported upgrade ERROR marker: {tail}")
                except Exception as e:
                    if "upgrade ERROR marker" in str(e):
                        raise
                    # Reboot / transient failure — just keep polling.
                    logger.debug(f"upgradestatus poll failed for {firewall.hostname}: {e}")

                # Primary completion check: query firmware/status and compare.
                try:
                    status_now = await api_client.get_firmware_status()
                    successful_polls_after_trigger += 1
                    version_now = extract_firmware_version(status_now)
                    pending_now = extract_firmware_update_count(status_now)
                    last_observed_version = version_now or last_observed_version
                    last_observed_pending = pending_now

                    version_changed = bool(
                        version_now
                        and update_record.version_before
                        and version_now != update_record.version_before
                    )
                    pending_cleared = (
                        pending_now == 0
                        and pending_count_before > 0
                        and successful_polls_after_trigger >= 2
                        and elapsed >= min_wait_before_done
                    )

                    if version_changed or pending_cleared:
                        logger.info(
                            f"Update completed on {firewall.hostname}: "
                            f"version {update_record.version_before} -> {version_now}, "
                            f"pending {pending_count_before} -> {pending_now} "
                            f"(version_changed={version_changed}, pending_cleared={pending_cleared})"
                        )
                        completed = True
                        # Refresh the pending count from OPNsense before the
                        # success path so the dashboard updates immediately.
                        try:
                            await api_client.check_firmware_updates()
                        except Exception:
                            pass
                        break
                except Exception as e:
                    # Likely a reboot in progress — just keep polling.
                    logger.debug(f"firmware/status poll failed for {firewall.hostname}: {e}")

                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

            if not completed:
                raise Exception(
                    f"Firmware update did not complete within {max_wait}s "
                    f"(saw_running={saw_running}, action={action}, "
                    f"version_before={update_record.version_before}, "
                    f"version_last_seen={last_observed_version}, "
                    f"pending_before={pending_count_before}, "
                    f"pending_last_seen={last_observed_pending})"
                )

            # OPNsense reboots itself when the firmware job requires it
            # (firmware/upgrade triggers its own reboot; firmware/update for
            # plain package updates usually doesn't need one). We just record
            # whether a reboot is pending for informational purposes — calling
            # reboot_system() manually here previously caused premature reboots
            # while configd was still running pkg upgrade.
            try:
                status_after = await api_client.get_firmware_status()
                if extract_needs_reboot(status_after):
                    update_record.log += "; reboot_pending=true (handled by OPNsense)"
            except Exception as e:
                logger.warning(f"post-update firmware/status check failed for {firewall.hostname}: {e}")
                status_after = {}

            # Verify update
            status_final = status_after or await api_client.get_firmware_status()
            update_record.version_after = extract_firmware_version(status_final)
            update_record.status = "success"
            update_record.completed_at = datetime.utcnow()

            logger.info(f"Update successful: {update_record.version_before} -> {update_record.version_after}")

        except Exception as e:
            logger.error(f"Update failed for {firewall.hostname}: {e}")
            update_record.status = "failed"
            if update_record.log:
                update_record.log = f"{update_record.log}; error={e}"
            else:
                update_record.log = str(e)
            update_record.completed_at = datetime.utcnow()

            # Send alert email
            from app.services.email_service import resolve_firewall_recipients
            recipients = resolve_firewall_recipients(firewall, "general")
            if recipients:
                EmailService.send_update_failed_alert(
                    firewall.customer_name,
                    firewall.hostname,
                    recipients,
                    str(e)
                )

            # Create alert in database
            alert = Alert(
                firewall_id=firewall.id,
                alert_type="update_failed",
                severity="critical",
                message=f"Firmware update failed on {firewall.hostname}: {str(e)}"
            )
            db.add(alert)

        db.add(update_record)
        db.commit()

        return update_record

    @staticmethod
    async def check_pending_updates(db: Session) -> dict:
        """Check all firewalls for pending updates"""

        firewalls = db.query(Firewall).all()
        updates_available = []

        for fw in firewalls:
            try:
                # Decrypt API secret
                api_secret = EncryptionService.decrypt(fw.api_secret)

                # Initialize API client
                api_client = OPNsenseAPI(
                    fw.ip,
                    fw.api_key,
                    api_secret,
                    fw.verify_ssl,
                    fw.ssl_cert_path
                )

                # Check for updates
                status = await api_client.get_firmware_status()
                try:
                    firmware_info = await api_client.get_firmware_info()
                    status = merge_firmware_info_into_status(status, firmware_info)
                except Exception:
                    pass
                updates_count = extract_firmware_update_count(status)
                if updates_count > 0:
                    updates_available.append({
                        "firewall_id": fw.id,
                        "hostname": fw.hostname,
                        "customer": fw.customer_name,
                        "current_version": extract_firmware_version(status),
                        "latest_version": extract_latest_firmware_version(status),
                        "updates_count": updates_count,
                    })

            except Exception as e:
                logger.error(f"Failed to check updates for {fw.hostname}: {e}")

        return {"available_updates": updates_available}

    @staticmethod
    def get_scheduled_updates_for_window(db: Session) -> list:
        """Get firewalls scheduled for auto-update in current window"""

        from datetime import datetime
        now = datetime.utcnow()
        current_day = now.strftime("%a").lower()[:3]
        current_hour = now.hour

        # This is a simplified check - in production, use APScheduler
        # For now, just find firewalls with auto_update=True
        firewalls = db.query(Firewall).filter(
            Firewall.auto_update == True
        ).all()

        scheduled = []
        for fw in firewalls:
            window = fw.auto_update_window  # Format: "sun:02:00"
            if window:
                day, time_str = window.split(":")
                hour, minute = map(int, time_str.split(":"))

                # Check if within window (allowing 10 minute grace period)
                if current_day == day and current_hour == hour:
                    scheduled.append(fw)

        return scheduled
