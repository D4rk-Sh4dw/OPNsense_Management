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

            # Download current configuration XML directly from OPNsense
            backup_data = await api_client.download_current_config()
            if not backup_data:
                raise Exception("Empty configuration returned from firewall")

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
                filename=local_filename,
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
    def _merge_partial_xml(current_xml: bytes, backup_xml: bytes, areas: list) -> bytes:
        """Replace selected top-level sections in current_xml with those from backup_xml.

        Operates on direct children of <opnsense>. Unknown areas are ignored.
        Returns the merged XML as bytes.
        """
        import xml.etree.ElementTree as ET

        cur_root = ET.fromstring(current_xml)
        bak_root = ET.fromstring(backup_xml)

        for area in areas:
            # Remove existing area(s) in current
            for elem in list(cur_root.findall(area)):
                cur_root.remove(elem)
            # Copy from backup (may be multiple, e.g. <interfaces><wan/>...)
            for elem in bak_root.findall(area):
                cur_root.append(elem)

        return ET.tostring(cur_root, encoding="utf-8", xml_declaration=True)

    @staticmethod
    async def restore_backup(
        firewall: Firewall,
        backup_file: str,
        areas: list | None = None,
    ) -> dict:
        """Restore a backup to a firewall.

        If `areas` is provided and non-empty, only those top-level XML sections are restored
        by merging into the firewall's current configuration. Otherwise the full backup XML
        is uploaded.
        """
        try:
            api_secret = EncryptionService.decrypt(firewall.api_secret)

            with open(backup_file, "rb") as f:
                backup_data = f.read()

            api_client = OPNsenseAPI(
                firewall.ip,
                firewall.api_key,
                api_secret,
                firewall.verify_ssl,
                firewall.ssl_cert_path,
            )

            payload_bytes = backup_data
            if areas:
                current = await api_client.download_current_config()
                payload_bytes = BackupService._merge_partial_xml(current, backup_data, areas)

            import base64
            payload = base64.b64encode(payload_bytes).decode()

            result = await api_client.restore_backup("", payload)
            logger.info(f"Backup restored to {firewall.hostname}: {result}")
            return result

        except Exception as e:
            logger.error(f"Backup restore failed: {e}")
            raise
