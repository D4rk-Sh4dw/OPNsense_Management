"""
Service for managing firewall config revisions (change history + rollback).
Handles syncing revisions from OPNsense, comparing configs, and restoring old versions.
"""
import logging
import hashlib
import difflib
import xml.dom.minidom
import re
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Firewall, ConfigHistory, Backup
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService
from app.services.backup_service import BackupService
from app.config import get_now

logger = logging.getLogger(__name__)


class ConfigHistoryService:
    """Service for managing firewall config revisions (change history + rollback)."""

    @staticmethod
    def _make_api_client(firewall: Firewall) -> OPNsenseAPI:
        """Create an OPNsenseAPI client for a specific firewall."""
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        return OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path
        )

    @staticmethod
    async def sync_revisions(db: Session, firewall: Firewall) -> int:
        """Pull config history from OPNsense, store new rows in DB.
        Returns count of NEW revisions added.
        Raises exception if API call fails.
        """
        api = ConfigHistoryService._make_api_client(firewall)
        try:
            listing = await api.list_remote_backups()
            logger.info(f"Got config backup listing for {firewall.hostname}: {type(listing)} with keys {list(listing.keys()) if isinstance(listing, dict) else 'N/A'}")
        except Exception as e:
            logger.error(f"Failed to list config revisions for {firewall.hostname}: {e}", exc_info=True)
            raise ValueError(f"Failed to fetch config history from {firewall.hostname}: {str(e)}")

        # OPNsense returns either a dict or a plain list. Normalize:
        if isinstance(listing, dict):
            items = listing.get("backups") or listing.get("rows") or listing.get("items") or []
        elif isinstance(listing, list):
            items = listing
        else:
            items = []

        logger.info(f"Processing {len(items)} backup items for {firewall.hostname}")
        added = 0
        skipped = 0
        
        # Log the first item to see the actual structure
        if items and len(items) > 0:
            logger.info(f"First item structure: {items[0]}")
        
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                logger.debug(f"Skipping item {idx}: not a dict, type={type(item)}")
                skipped += 1
                continue
            
            # OPNsense uses 'id' field for the revision identifier
            revision_id = item.get("id")
            if not revision_id:
                logger.debug(f"Skipping item {idx}: no 'id' field. Keys: {list(item.keys())}")
                skipped += 1
                continue

            # Parse timestamp: prefer ISO format, fallback to epoch
            rev_date = None
            if item.get("time_iso"):
                try:
                    rev_date = datetime.fromisoformat(item.get("time_iso").replace("Z", "+00:00"))
                except Exception as e:
                    logger.debug(f"Failed to parse time_iso '{item.get('time_iso')}': {e}")
            
            if not rev_date and item.get("time"):
                try:
                    timestamp = float(item.get("time"))
                    rev_date = datetime.fromtimestamp(timestamp)
                except Exception as e:
                    logger.debug(f"Failed to parse time '{item.get('time')}': {e}")
            
            if not rev_date:
                rev_date = get_now()

            # Check if revision already exists
            existing = db.query(ConfigHistory).filter(
                ConfigHistory.firewall_id == firewall.id,
                ConfigHistory.revision_id == revision_id,
            ).first()
            if existing:
                logger.debug(f"Skipping item {idx} ({revision_id}): already tracked")
                skipped += 1
                continue

            row = ConfigHistory(
                firewall_id=firewall.id,
                revision_id=revision_id,
                revision_date=rev_date,
                changed_by=item.get("username"),
                summary=item.get("description"),
                size_bytes=item.get("filesize"),
            )
            db.add(row)
            logger.debug(f"Added revision {idx}: {revision_id} (date: {rev_date})")
            added += 1

        if added > 0:
            db.commit()
            logger.info(f"ConfigHistory sync for {firewall.hostname}: +{added} new revisions stored (skipped {skipped})")
        else:
            logger.info(f"ConfigHistory sync for {firewall.hostname}: no new revisions (added={added}, skipped={skipped})")
        return added

    @staticmethod
    def _parse_revision_date(filename: str, item: dict) -> datetime | None:
        """Try multiple strategies to derive the revision timestamp."""
        # 1. Explicit date field in API response
        for key in ("date", "timestamp", "created", "mtime"):
            v = item.get(key)
            if isinstance(v, (int, float)) and v > 0:
                try:
                    return datetime.fromtimestamp(int(v))
                except Exception:
                    pass
            if isinstance(v, str):
                try:
                    return datetime.fromisoformat(v.replace("Z", "+00:00"))
                except Exception:
                    pass

        # 2. Numeric epoch in filename: config-1234567890.xml
        m = re.search(r"(\d{10})", filename)
        if m:
            try:
                return datetime.fromtimestamp(int(m.group(1)))
            except Exception:
                pass

        # 3. ISO date in filename: config-2024-12-25T10:30:00.xml
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})[T_\s](\d{2})[:.]\d{2}[:.]\d{2}", filename)
        if m:
            try:
                year, month, day, hour = m.groups()
                return datetime(int(year), int(month), int(day), int(hour))
            except Exception:
                pass

        return None

    @staticmethod
    async def diff_revisions(
        db: Session, firewall: Firewall, revision_a_id: str, revision_b_id: str
    ) -> dict:
        """Return a unified diff between two revisions.
        Downloads both XMLs and compares them.
        """
        # Load metadata rows
        row_a = db.query(ConfigHistory).filter(ConfigHistory.id == revision_a_id).first()
        row_b = db.query(ConfigHistory).filter(ConfigHistory.id == revision_b_id).first()
        if not row_a or not row_b:
            raise ValueError("Revision not found")
        if row_a.firewall_id != firewall.id or row_b.firewall_id != firewall.id:
            raise ValueError("Revision does not belong to firewall")

        api = ConfigHistoryService._make_api_client(firewall)

        # Download both XMLs
        try:
            xml_a_bytes = await api.download_backup_by_name("this", row_a.revision_id)
            xml_b_bytes = await api.download_backup_by_name("this", row_b.revision_id)
        except Exception as e:
            logger.error(f"Failed to download config revisions for diff: {e}")
            raise ValueError(f"Could not download revisions: {e}")

        # Pretty-print and split into lines
        def pretty(b: bytes) -> list[str]:
            try:
                dom = xml.dom.minidom.parseString(b)
                return dom.toprettyxml(indent="  ").splitlines()
            except Exception:
                return b.decode("utf-8", errors="replace").splitlines()

        lines_a = pretty(xml_a_bytes)
        lines_b = pretty(xml_b_bytes)

        # Compute unified diff
        diff = list(difflib.unified_diff(
            lines_a, lines_b,
            fromfile=row_a.revision_id, tofile=row_b.revision_id,
            lineterm=""
        ))
        additions = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
        deletions = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))

        # Update hashes for future caching
        row_a.config_hash = hashlib.sha256(xml_a_bytes).hexdigest()
        row_b.config_hash = hashlib.sha256(xml_b_bytes).hexdigest()
        db.commit()

        return {
            "revision_a": row_a.revision_id,
            "revision_b": row_b.revision_id,
            "lines": diff,
            "additions": additions,
            "deletions": deletions,
        }

    @staticmethod
    async def revert_to_revision(
        db: Session, firewall: Firewall, revision_id: str, create_backup: bool = True
    ) -> dict:
        """Roll back the firewall to a specific revision.
        Creates a CMS backup first (safety net) unless create_backup=False.
        """
        row = db.query(ConfigHistory).filter(ConfigHistory.id == revision_id).first()
        if not row or row.firewall_id != firewall.id:
            raise ValueError("Revision not found")

        # Safety net: snapshot current config to CMS first
        if create_backup:
            try:
                await BackupService.create_backup(db, firewall, triggered_by="pre-revert")
                logger.info(f"Pre-revert backup created for {firewall.hostname}")
            except Exception as e:
                logger.warning(f"Pre-revert backup failed for {firewall.hostname}: {e}")
                # Continue anyway — user explicitly requested revert

        api = ConfigHistoryService._make_api_client(firewall)
        try:
            result = await api.revert_backup(row.revision_id)
            logger.info(f"Reverted {firewall.hostname} to {row.revision_id}: {result}")
            return {
                "firewall_id": str(firewall.id),
                "reverted_to": row.revision_id,
                "revision_date": row.revision_date.isoformat(),
                "result": result,
            }
        except Exception as e:
            logger.error(f"Revert failed for {firewall.hostname}: {e}")
            raise ValueError(f"Revert failed: {e}")
