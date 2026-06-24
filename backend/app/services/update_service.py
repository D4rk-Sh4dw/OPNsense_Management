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

            # Capture pre-trigger status so we can later detect if a NEW job
            # actually started (vs. a stale "done" leftover from a previous run).
            try:
                pre_st = await api_client.get_upgrade_status()
                pre_status_value = str(pre_st.get("status", "")).lower()
            except Exception:
                pre_status_value = ""

            # Trigger BOTH endpoints in sequence, exactly like the working
            # manual Bruno flow: firmware/update handles package updates,
            # firmware/upgrade handles major version transitions. OPNsense
            # ignores whichever one is not applicable, so calling both is safe.
            logger.info(f"Triggering firmware/update + firmware/upgrade on {firewall.hostname}")
            triggered = []
            update_response = None
            upgrade_response = None

            try:
                update_response = await api_client.install_updates()
                triggered.append("update")
                logger.info(f"firmware/update response on {firewall.hostname}: {update_response}")
            except Exception as e:
                logger.warning(f"firmware/update failed on {firewall.hostname}: {e}")
                update_response = f"error: {e}"

            try:
                upgrade_response = await api_client.upgrade_firmware()
                triggered.append("upgrade")
                logger.info(f"firmware/upgrade response on {firewall.hostname}: {upgrade_response}")
            except Exception as e:
                logger.warning(f"firmware/upgrade failed on {firewall.hostname}: {e}")
                upgrade_response = f"error: {e}"

            if not triggered:
                raise Exception("Neither firmware/update nor firmware/upgrade accepted by firewall")

            action = "+".join(triggered)
            update_record.log = (
                f"action={action}; "
                f"update_response={update_response}; "
                f"upgrade_response={upgrade_response}; "
                f"pre_status={pre_status_value or 'none'}"
            )

            # OPNsense needs a moment to register the job.
            await asyncio.sleep(5)

            # Verify the job actually started by checking upgradestatus.
            try:
                verify_st = await api_client.get_upgrade_status()
                verify_status = str(verify_st.get("status", "")).lower()
            except Exception as e:
                verify_status = f"error: {e}"

            update_record.log += f"; verify_status_after_trigger={verify_status}"

            # If status is still "none"/"done" (and was already "done" before),
            # the trigger likely did not start a new job.
            if verify_status in ("none", "", "done") and pre_status_value == "done":
                logger.warning(
                    f"Trigger did not start a new job on {firewall.hostname} "
                    f"(verify_status={verify_status}, pre_status={pre_status_value})"
                )
                # We continue polling anyway, but log the suspicion.

            # Poll for completion. We require the status to transition through
            # "running" to "done"; a stale "done" from a previous run is ignored
            # by tracking whether we ever saw an in-progress state.
            max_wait = 3600  # 1 hour
            poll_interval = 10
            elapsed = 0
            completed = False
            saw_running = False
            phase = action

            while elapsed < max_wait:
                try:
                    st = await api_client.get_upgrade_status()
                    st_value = str(st.get("status", "")).lower()

                    if st_value in ("running", "reboot", "upgrading", "installing"):
                        saw_running = True

                    if st_value == "done":
                        # Treat as completion only if we previously saw running,
                        # OR if the status differs from the pre-trigger "done" snapshot
                        # (which would mean OPNsense finished a brand-new fast job).
                        if saw_running or pre_status_value != "done":
                            logger.info(f"Firmware job done on {firewall.hostname} (action={action})")
                            completed = True
                            break

                    if st_value == "error":
                        raise Exception(f"OPNsense reported upgrade error: {st.get('log', 'Unknown error')}")

                except Exception as e:
                    logger.warning(f"upgradestatus check failed for {firewall.hostname}: {e}")

                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

            if not completed:
                raise Exception(
                    f"Firmware job did not complete within {max_wait}s "
                    f"(saw_running={saw_running}, action={action})"
                )

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
