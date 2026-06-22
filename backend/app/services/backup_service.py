import logging
import os
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Firewall, Backup, Alert
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class BackupService:
    """Service for managing firewall backups"""

    @staticmethod
    def _get_backup_directory(firewall_id: str) -> Path:
        """Get backup directory for a firewall"""
        backup_dir = Path(settings.BACKUP_DIRECTORY) / str(firewall_id)
        backup_dir.mkdir(parents=True, exist_ok=True)
        return backup_dir

    @staticmethod
    async def create_backup(
        db: Session,
        firewall: Firewall,
        triggered_by: str = "manual"
    ) -> Backup:
        """
        Create a backup of firewall configuration

        Args:
            db: Database session
            firewall: Firewall instance
            triggered_by: Trigger source ("manual", "auto", "pre-update")

        Returns:
            Backup record
        """
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

            # Create backup on firewall
            backup_response = await api_client.create_backup()
            logger.info(f"Backup created on {firewall.hostname}: {backup_response}")

            # Get backup list to find the newest backup
            backups_list = await api_client.list_backups()
            if not backups_list.get("backups"):
                raise Exception("No backups found after creation")

            # Download the newest backup
            latest_backup = sorted(
                backups_list["backups"],
                key=lambda x: x.get("mtime", 0),
                reverse=True
            )[0]

            filename = latest_backup["filename"]
            backup_data = await api_client.download_backup(filename)

            # Save backup locally
            backup_dir = BackupService._get_backup_directory(firewall.id)
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            local_filename = f"{timestamp}_{firewall.hostname}.xml"
            filepath = backup_dir / local_filename

            with open(filepath, "wb") as f:
                f.write(backup_data)

            # Record in database
            backup = Backup(
                firewall_id=firewall.id,
                filename=filename,
                filepath=str(filepath),
                size_bytes=len(backup_data),
                triggered_by=triggered_by
            )
            db.add(backup)
            db.commit()

            logger.info(f"Backup saved: {filepath} ({len(backup_data)} bytes)")
            return backup

        except Exception as e:
            logger.error(f"Backup creation failed for {firewall.hostname}: {e}")
            # Record error in database
            backup = Backup(
                firewall_id=firewall.id,
                filename="failed",
                filepath="",
                triggered_by=triggered_by,
                last_error=str(e)
            )
            db.add(backup)
            db.commit()
            raise

    @staticmethod
    async def cleanup_old_backups(
        db: Session,
        firewall: Firewall
    ) -> None:
        """
        Delete old backups exceeding retention policy

        Args:
            db: Database session
            firewall: Firewall instance
        """
        try:
            # Get backups from database
            backups = db.query(Backup).filter(
                Backup.firewall_id == firewall.id
            ).order_by(Backup.created_at.desc()).all()

            # Delete old backups from filesystem and database
            for backup in backups[firewall.backup_retention:]:
                if backup.filepath and os.path.exists(backup.filepath):
                    os.remove(backup.filepath)
                    logger.info(f"Deleted old backup: {backup.filepath}")
                db.delete(backup)

            db.commit()

        except Exception as e:
            logger.error(f"Backup cleanup failed for {firewall.hostname}: {e}")

    @staticmethod
    async def list_backups(
        db: Session,
        firewall_id: str
    ) -> list:
        """List backups for a firewall"""
        return db.query(Backup).filter(
            Backup.firewall_id == firewall_id
        ).order_by(Backup.created_at.desc()).all()

    @staticmethod
    async def restore_backup(
        firewall: Firewall,
        backup_file: str
    ) -> dict:
        """
        Restore a backup to a firewall

        Args:
            firewall: Target firewall
            backup_file: Path to backup file

        Returns:
            Restore response
        """
        try:
            # Decrypt API secret
            api_secret = EncryptionService.decrypt(firewall.api_secret)

            # Read backup file
            with open(backup_file, "rb") as f:
                backup_data = f.read()

            # Encode for API
            import base64
            payload = base64.b64encode(backup_data).decode()

            # Initialize API client
            api_client = OPNsenseAPI(
                firewall.ip,
                firewall.api_key,
                api_secret,
                firewall.verify_ssl,
                firewall.ssl_cert_path
            )

            # Restore backup
            result = await api_client.restore_backup("", payload)
            logger.info(f"Backup restored to {firewall.hostname}: {result}")
            return result

        except Exception as e:
            logger.error(f"Backup restore failed: {e}")
            raise
