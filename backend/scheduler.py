"""
Scheduled tasks for OPNsense CMS
Run this as a separate process: python scheduler.py
"""

import logging
import asyncio
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session
from app.database import SessionLocal, engine, Base
from app.config import get_settings
from app.models import Firewall, Alert, LicenseNotification
from app.services.monitoring_service import MonitoringService
from app.services.backup_service import BackupService
from app.services.update_service import UpdateService
from app.services.email_service import EmailService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


def get_db() -> Session:
    """Get database session"""
    db = SessionLocal()
    try:
        return db
    finally:
        db.close()


async def monitor_all_firewalls():
    """Check health of all firewalls"""
    logger.info("Starting health monitoring...")
    db = get_db()

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
    db = get_db()

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
    db = get_db()

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
    db = get_db()

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


def sync_job(coro):
    """Convert async function to sync for APScheduler"""
    loop = asyncio.get_event_loop()
    if loop.is_running():
        # Schedule as task
        loop.create_task(coro)
    else:
        loop.run_until_complete(coro)


def start_scheduler():
    """Start APScheduler with all tasks"""

    # Create tables
    Base.metadata.create_all(bind=engine)

    scheduler = BackgroundScheduler()

    # Add jobs
    scheduler.add_job(
        lambda: sync_job(monitor_all_firewalls()),
        'interval',
        minutes=settings.MONITORING_INTERVAL_MINUTES,
        id='monitor_firewalls',
        name='Monitor all firewalls'
    )

    scheduler.add_job(
        lambda: sync_job(check_license_expiry()),
        'cron',
        hour=settings.LICENSE_CHECK_HOUR,
        id='check_licenses',
        name='Check license expiry'
    )

    scheduler.add_job(
        lambda: sync_job(backup_all_firewalls()),
        'cron',
        hour=settings.BACKUP_CHECK_HOUR,
        id='backup_firewalls',
        name='Create automatic backups'
    )

    scheduler.add_job(
        lambda: sync_job(auto_update_firewalls()),
        'cron',
        minute=0,
        id='auto_updates',
        name='Apply automatic updates'
    )

    scheduler.start()
    logger.info("Scheduler started with all tasks")

    # Keep running
    try:
        while True:
            pass
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        logger.info("Scheduler stopped")


if __name__ == "__main__":
    start_scheduler()
