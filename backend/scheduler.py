"""
Scheduled tasks for OPNsense CMS
Run this as a separate process: python scheduler.py
"""

import logging
import asyncio
from datetime import datetime, timedelta
from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy.orm import Session
from app.database import SessionLocal, engine, Base
from app.config import get_settings
from app.models import Firewall, Alert, LicenseNotification
from app.services.monitoring_service import MonitoringService
from app.services.backup_service import BackupService
from app.services.update_service import UpdateService
from app.services.email_service import EmailService
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


def _new_session() -> Session:
    """Create a fresh DB session for a scheduled task."""
    return SessionLocal()


async def monitor_all_firewalls():
    """Check health of all firewalls"""
    logger.info("Starting health monitoring...")
    db = _new_session()

    try:
        firewalls = db.query(Firewall).all()

        for fw in firewalls:
            try:
                await MonitoringService.check_firewall_health(db, fw)
                logger.info(f"Health check completed: {fw.hostname}")
            except Exception as e:
                logger.error(f"Health check failed for {fw.hostname}: {e}")

    finally:
        db.close()


async def check_license_expiry():
    """Check for expiring licenses and send alerts"""
    logger.info("Checking license expiry...")
    db = _new_session()

    try:
        firewalls = db.query(Firewall).filter(Firewall.license_expiry != None).all()
        today = datetime.utcnow()

        for fw in firewalls:
            if not fw.license_expiry:
                continue

            days_until_expiry = (fw.license_expiry.date() - today.date()).days

            # Check for 14, 7, and 1 day thresholds
            for threshold in [14, 7, 1]:
                if days_until_expiry == threshold and fw.notify_email:
                    # Check if we've already sent notification for this threshold
                    existing = db.query(LicenseNotification).filter(
                        LicenseNotification.firewall_id == fw.id,
                        LicenseNotification.days_remaining == threshold
                    ).first()

                    if not existing:
                        # Send email
                        EmailService.send_license_expiry_alert(
                            fw.customer_name,
                            fw.hostname,
                            fw.notify_email,
                            str(fw.license_expiry.date()),
                            threshold
                        )

                        # Record notification
                        notification = LicenseNotification(
                            firewall_id=fw.id,
                            days_remaining=threshold
                        )
                        db.add(notification)
                        logger.info(f"License expiry alert sent for {fw.hostname}: {threshold} days")

        db.commit()

    except Exception as e:
        logger.error(f"License expiry check failed: {e}")
    finally:
        db.close()


async def backup_all_firewalls():
    """Create automated backups"""
    logger.info("Starting backup task...")
    db = _new_session()

    try:
        firewalls = db.query(Firewall).all()

        for fw in firewalls:
            try:
                # Check backup interval
                # This is simplified - in production use proper scheduling
                if fw.backup_interval in ["daily", "weekly"]:
                    await BackupService.create_backup(db, fw, "auto")
                    await BackupService.cleanup_old_backups(db, fw)
                    logger.info(f"Backup completed: {fw.hostname}")
            except Exception as e:
                logger.error(f"Backup failed for {fw.hostname}: {e}")

    finally:
        db.close()


async def auto_update_firewalls():
    """Apply automatic firmware updates within maintenance windows"""
    logger.info("Checking for scheduled updates...")
    db = _new_session()

    try:
        scheduled_updates = UpdateService.get_scheduled_updates_for_window(db)

        for fw in scheduled_updates:
            try:
                logger.info(f"Starting auto-update for {fw.hostname}")
                await UpdateService.install_updates(db, fw, "auto")
            except Exception as e:
                logger.error(f"Auto-update failed for {fw.hostname}: {e}")

    finally:
        db.close()


async def smart_check_all_firewalls():
    """Daily S.M.A.R.T. disk health check across all firewalls."""
    logger.info("Starting S.M.A.R.T. check...")
    db = _new_session()

    try:
        firewalls = db.query(Firewall).all()
        for fw in firewalls:
            try:
                api_secret = EncryptionService.decrypt(fw.api_secret)
                api = OPNsenseAPI(
                    fw.ip, fw.api_key, api_secret,
                    fw.verify_ssl, fw.ssl_cert_path,
                )

                listing = await api.smart_list()
                rows = (
                    listing.get("rows")
                    or listing.get("devices")
                    or listing.get("items")
                    or []
                )
                devices = []
                for d in rows:
                    if not isinstance(d, dict):
                        continue
                    dev = d.get("dev") or d.get("device") or d.get("name")
                    if not dev:
                        continue
                    try:
                        info = await api.smart_info(dev, d.get("type") or "auto")
                    except Exception as e:
                        logger.debug(f"smart_info failed for {fw.hostname}/{dev}: {e}")
                        info = {}
                    devices.append({
                        "name": dev,
                        "status": d.get("status") or info.get("status"),
                        "attributes": info.get("attributes") or info.get("rows") or [],
                    })

                MonitoringService.check_smart_health(db, fw, {"devices": devices})
                logger.info(f"S.M.A.R.T. check completed: {fw.hostname}")
            except Exception as e:
                logger.warning(f"S.M.A.R.T. check failed for {fw.hostname}: {e}")
    finally:
        db.close()


def sync_job(coro_factory):
    """Run an async coroutine in its own event loop from APScheduler thread."""
    try:
        asyncio.run(coro_factory())
    except Exception as e:
        logger.exception(f"Scheduled job crashed: {e}")


def start_scheduler():
    """Start APScheduler with all tasks (blocking)"""

    # Create tables
    Base.metadata.create_all(bind=engine)

    scheduler = BlockingScheduler()

    # Add jobs
    scheduler.add_job(
        sync_job,
        'interval',
        minutes=settings.MONITORING_INTERVAL_MINUTES,
        args=[monitor_all_firewalls],
        id='monitor_firewalls',
        name='Monitor all firewalls'
    )

    scheduler.add_job(
        sync_job,
        'cron',
        hour=settings.LICENSE_CHECK_HOUR,
        args=[check_license_expiry],
        id='check_licenses',
        name='Check license expiry'
    )

    scheduler.add_job(
        sync_job,
        'cron',
        hour=settings.BACKUP_CHECK_HOUR,
        args=[backup_all_firewalls],
        id='backup_firewalls',
        name='Create automatic backups'
    )

    scheduler.add_job(
        sync_job,
        'cron',
        minute=0,
        args=[auto_update_firewalls],
        id='auto_updates',
        name='Apply automatic updates'
    )

    scheduler.add_job(
        sync_job,
        'cron',
        hour=settings.SMART_CHECK_HOUR,
        args=[smart_check_all_firewalls],
        id='smart_check',
        name='Daily S.M.A.R.T. disk check'
    )

    logger.info("Scheduler starting...")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")


if __name__ == "__main__":
    start_scheduler()
