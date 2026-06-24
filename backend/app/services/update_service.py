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

            # Ensure update metadata is fresh before deciding which endpoint to call.
            try:
                await api_client.check_firmware_updates()
                status_before = await api_client.get_firmware_status()
                update_record.version_before = extract_firmware_version(status_before)
            except Exception as e:
                logger.warning(f"firmware/check failed for {firewall.hostname}: {e}")

            pending_count = extract_firmware_update_count(status_before)
            if pending_count <= 0:
                raise Exception("No updates pending on firewall")
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
            #   status="upgrade" → /firmware/upgrade with target from status_upgrade_action
            top_status = ""
            status_upgrade_action = ""
            product_version = ""
            product_latest = ""
            if isinstance(status_before, dict):
                top_status = str(status_before.get("status", "")).lower()
                status_upgrade_action = str(status_before.get("status_upgrade_action", "")).lower()
                product_version = str(status_before.get("product_version", "")).strip()
                product_latest = str(status_before.get("product_latest", "")).strip()

            use_upgrade = top_status in ("upgrade", "release_update")

            # Determine the value to send as `upgrade=<target>` to /firmware/upgrade:
            #   * status_upgrade_action="pkg" → package-only upgrade (same version)
            #   * status_upgrade_action="rel"/"all" → release upgrade to product_latest
            #   * otherwise → derive from product_latest, fall back to "pkg"
            if status_upgrade_action == "pkg":
                upgrade_target = "pkg"
            elif status_upgrade_action in ("rel", "all", "maj", "min") and product_latest:
                upgrade_target = product_latest
            elif product_latest and product_latest != product_version:
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
