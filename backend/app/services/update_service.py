import logging
import asyncio
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

            # Create pre-update backup
            logger.info(f"Creating pre-update backup for {firewall.hostname}")
            try:
                await BackupService.create_backup(db, firewall, "pre-update")
            except Exception as e:
                logger.warning(f"Pre-update backup failed: {e}")
                # Continue with update anyway

            # Trigger update/upgrade depending on payload shape.
            is_upgrade_path = (
                str(status_before.get("status", "")).lower() in ("upgrade", "major")
                or bool(status_before.get("upgrade_sets"))
            )
            action = "upgrade" if is_upgrade_path else "update"
            logger.info(f"Starting firmware {action} on {firewall.hostname}")

            if is_upgrade_path:
                update_response = await api_client.upgrade_firmware()
            else:
                update_response = await api_client.install_updates()

            update_record.log = f"action={action}; response={update_response}"

            # Poll for completion. If we don't see any upgrade-status activity
            # shortly after starting, switch early to the other endpoint.
            max_wait = 3600  # 1 hour final wait
            poll_interval = 10
            initial_probe_wait = 30

            async def _poll_until_done(wait_seconds: int, phase: str):
                elapsed_local = 0
                saw_activity = False

                while elapsed_local < wait_seconds:
                    await asyncio.sleep(poll_interval)
                    elapsed_local += poll_interval

                    try:
                        st = await api_client.get_upgrade_status()
                        st_value = str(st.get("status", "")).lower()
                        if st_value and st_value not in ("none", "unknown"):
                            saw_activity = True

                        if st_value == "done":
                            return True, saw_activity
                        if st_value == "error":
                            raise Exception(f"Update error ({phase}): {st.get('log', 'Unknown error')}")
                    except Exception as e:
                        logger.warning(f"Status check failed ({phase}): {e}")

                return False, saw_activity

            completed = False
            used_action = action

            # Quick probe: if no status activity is visible, try fallback immediately.
            completed, saw_activity = await _poll_until_done(initial_probe_wait, "initial")

            if not completed and not saw_activity:
                fallback_action = "update" if action == "upgrade" else "upgrade"
                logger.warning(
                    f"No upgrade-status activity after {initial_probe_wait}s for {firewall.hostname}; trying fallback {fallback_action}"
                )
                try:
                    if fallback_action == "upgrade":
                        fallback_response = await api_client.upgrade_firmware()
                    else:
                        fallback_response = await api_client.install_updates()
                    update_record.log = (
                        f"{update_record.log}; fallback_action={fallback_action}; "
                        f"fallback_response={fallback_response}"
                    )
                    used_action = fallback_action
                except Exception as e:
                    logger.warning(f"Fallback {fallback_action} start failed on {firewall.hostname}: {e}")
                    update_record.log = f"{update_record.log}; fallback_action={fallback_action}; fallback_error={e}"

            if not completed:
                completed, _ = await _poll_until_done(max_wait, f"final-{used_action}")

            if not completed:
                raise Exception("Firmware job did not complete within timeout")

            # Check if reboot needed
            status_after = await api_client.get_firmware_status()
            if extract_needs_reboot(status_after):
                logger.info(f"Rebooting {firewall.hostname}")
                await api_client.reboot_system()
                # Wait for reboot
                await asyncio.sleep(60)

            # Verify update
            status_final = await api_client.get_firmware_status()
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
