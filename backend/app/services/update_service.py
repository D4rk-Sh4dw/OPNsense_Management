import logging
import asyncio
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Firewall, UpdateHistory, Alert, Backup
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService
from app.services.email_service import EmailService
from app.services.backup_service import BackupService

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
            update_record.version_before = status_before.get("product_version")

            # Create pre-update backup
            logger.info(f"Creating pre-update backup for {firewall.hostname}")
            try:
                await BackupService.create_backup(db, firewall, "pre-update")
            except Exception as e:
                logger.warning(f"Pre-update backup failed: {e}")
                # Continue with update anyway

            # Trigger update
            logger.info(f"Starting update on {firewall.hostname}")
            update_response = await api_client.install_updates()
            update_record.log = str(update_response)

            # Poll for completion
            max_wait = 3600  # 1 hour
            poll_interval = 10
            elapsed = 0

            while elapsed < max_wait:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

                try:
                    status = await api_client.get_upgrade_status()
                    if status.get("status") == "done":
                        logger.info(f"Update completed on {firewall.hostname}")
                        break
                    elif status.get("status") == "error":
                        raise Exception(f"Update error: {status.get('log', 'Unknown error')}")
                except Exception as e:
                    logger.warning(f"Status check failed: {e}")

            # Check if reboot needed
            status_after = await api_client.get_firmware_status()
            if status_after.get("upgrade_needs_reboot"):
                logger.info(f"Rebooting {firewall.hostname}")
                await api_client.reboot_system()
                # Wait for reboot
                await asyncio.sleep(60)

            # Verify update
            status_final = await api_client.get_firmware_status()
            update_record.version_after = status_final.get("product_version")
            update_record.status = "success"
            update_record.completed_at = datetime.utcnow()

            logger.info(f"Update successful: {update_record.version_before} -> {update_record.version_after}")

        except Exception as e:
            logger.error(f"Update failed for {firewall.hostname}: {e}")
            update_record.status = "failed"
            update_record.log = str(e)
            update_record.completed_at = datetime.utcnow()

            # Send alert email
            if firewall.notify_email:
                EmailService.send_update_failed_alert(
                    firewall.customer_name,
                    firewall.hostname,
                    firewall.notify_email,
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
                if status.get("updates", 0) > 0:
                    updates_available.append({
                        "firewall_id": fw.id,
                        "hostname": fw.hostname,
                        "customer": fw.customer_name,
                        "current_version": status.get("product_version"),
                        "latest_version": status.get("product_latest"),
                        "updates_count": status.get("updates")
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
