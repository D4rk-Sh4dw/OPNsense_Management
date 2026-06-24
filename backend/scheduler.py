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
from app.models import Firewall, Backup, LicenseNotification, SchedulerSettings
from app.services.monitoring_service import MonitoringService
from app.services.backup_service import BackupService
from app.services.update_service import UpdateService
from app.services.email_service import EmailService, resolve_firewall_recipients
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()
SCHEDULER_REFRESH_MINUTES = 1
BACKUP_SCAN_INTERVAL_MINUTES = 15
UPDATE_CHECK_INTERVAL_MINUTES = max(5, int(settings.UPDATE_CHECK_INTERVAL_MINUTES or 30))


def _new_session() -> Session:
    """Create a fresh DB session for a scheduled task."""
    return SessionLocal()


def _load_scheduler_values(db: Session) -> dict:
    row = db.query(SchedulerSettings).filter(SchedulerSettings.id == 1).first()
    if not row:
        row = SchedulerSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return {
        "monitoring_interval_minutes": max(1, int(row.monitoring_interval_minutes or settings.MONITORING_INTERVAL_MINUTES)),
        "license_check_hour": max(0, min(23, int(row.license_check_hour if row.license_check_hour is not None else settings.LICENSE_CHECK_HOUR))),
        "smart_check_hour": max(0, min(23, int(row.smart_check_hour if row.smart_check_hour is not None else settings.SMART_CHECK_HOUR))),
    }


def _parse_hh_mm(value: str | None, default_hour: int = 1) -> tuple[int, int]:
    if not value:
        return default_hour, 0
    try:
        hour_s, minute_s = str(value).split(":", 1)
        hour = max(0, min(23, int(hour_s)))
        minute = max(0, min(59, int(minute_s)))
        return hour, minute
    except Exception:
        return default_hour, 0


def _is_backup_due(fw: Firewall, last_auto: Backup | None, now: datetime) -> bool:
    interval = (fw.backup_interval or "daily").lower()
    if interval in ("off", "disabled", "none"):
        return False

    hour, minute = _parse_hh_mm(getattr(fw, "backup_time", None), default_hour=1)
    weekday = int(getattr(fw, "backup_weekday", 6) or 6)
    monthday = int(getattr(fw, "backup_monthday", 1) or 1)

    if interval == "hourly":
        if last_auto is None:
            return True
        return now - last_auto.created_at >= timedelta(hours=1)

    # For time-based schedules, run in a 15 minute window to avoid missing
    # exact minute alignment when the scheduler process restarts.
    in_window = now.hour == hour and minute <= now.minute < minute + BACKUP_SCAN_INTERVAL_MINUTES
    if not in_window:
        return False

    if interval == "daily":
        return last_auto is None or last_auto.created_at.date() != now.date()

    if interval == "weekly":
        if now.weekday() != max(0, min(6, weekday)):
            return False
        if last_auto is None:
            return True
        iso_now = now.isocalendar()
        iso_last = last_auto.created_at.isocalendar()
        return (iso_last.year, iso_last.week) != (iso_now.year, iso_now.week)

    if interval == "monthly":
        target_day = max(1, min(31, monthday))
        month_last_day = ((now.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day
        if now.day != min(target_day, month_last_day):
            return False
        if last_auto is None:
            return True
        return (last_auto.created_at.year, last_auto.created_at.month) != (now.year, now.month)

    return False


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
        default_thresholds = [int(x) for x in (settings.LICENSE_ALERT_DAYS or "30,14,7,1").split(",") if x.strip().isdigit()]

        for fw in firewalls:
            if not fw.license_expiry:
                continue

            days_until_expiry = (fw.license_expiry.date() - today.date()).days

            # Per-firewall thresholds override global default
            if fw.license_alert_days:
                thresholds = [int(x) for x in fw.license_alert_days.split(",") if x.strip().isdigit()]
            else:
                thresholds = default_thresholds

            recipients = resolve_firewall_recipients(fw, "license")

            for threshold in thresholds:
                if days_until_expiry != threshold or not recipients:
                    continue
                # Check if we've already sent notification for this threshold
                existing = db.query(LicenseNotification).filter(
                    LicenseNotification.firewall_id == fw.id,
                    LicenseNotification.days_remaining == threshold
                ).first()
                if existing:
                    continue

                EmailService.send_license_expiry_alert(
                    fw.customer_name,
                    fw.hostname,
                    recipients,
                    str(fw.license_expiry.date()),
                    threshold
                )

                db.add(LicenseNotification(firewall_id=fw.id, days_remaining=threshold))
                logger.info(f"License expiry alert sent for {fw.hostname}: {threshold} days")

        db.commit()

    except Exception as e:
        logger.error(f"License expiry check failed: {e}")
    finally:
        db.close()


async def backup_all_firewalls():
    """Create automated backups based on per-firewall schedules."""
    logger.info("Starting backup task...")
    db = _new_session()

    try:
        firewalls = db.query(Firewall).all()

        now = datetime.utcnow()

        for fw in firewalls:
            try:
                last_auto = (
                    db.query(Backup)
                    .filter(
                        Backup.firewall_id == fw.id,
                        Backup.triggered_by == "auto",
                        Backup.last_error.is_(None),
                    )
                    .order_by(Backup.created_at.desc())
                    .first()
                )

                if _is_backup_due(fw, last_auto, now):
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
                # Always refresh pending updates first to avoid stale
                # firmware/status responses in maintenance windows.
                update_state = await UpdateService.refresh_firewall_update_status(
                    db,
                    fw,
                    trigger_check=True,
                )
                pending = int(update_state.get("updates_available") or 0)
                if pending <= 0:
                    logger.info(
                        f"Skipping auto-update for {fw.hostname}: no pending updates "
                        f"(status_msg={update_state.get('status_msg')})"
                    )
                    continue

                logger.info(f"Starting auto-update for {fw.hostname} with {pending} pending update(s)")
                await UpdateService.install_updates(db, fw, "auto")
            except Exception as e:
                logger.error(f"Auto-update failed for {fw.hostname}: {e}")

    finally:
        db.close()


async def check_pending_updates_all_firewalls():
    """Refresh pending update status for all firewalls on a fixed interval."""
    logger.info("Refreshing pending update status...")
    db = _new_session()

    try:
        result = await UpdateService.check_pending_updates(db)
        count = len(result.get("available_updates", []))
        logger.info(f"Pending update refresh completed: {count} firewall(s) with updates")
    except Exception as e:
        logger.error(f"Pending update refresh failed: {e}")
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


def refresh_scheduler_jobs(scheduler: BlockingScheduler):
    """Apply runtime scheduler settings from DB without process restart."""
    db = _new_session()
    try:
        cfg = _load_scheduler_values(db)
    except Exception as e:
        logger.warning(f"Could not load scheduler settings: {e}")
        db.close()
        return
    finally:
        db.close()

    try:
        scheduler.reschedule_job(
            "monitor_firewalls",
            trigger="interval",
            minutes=cfg["monitoring_interval_minutes"],
        )
        scheduler.reschedule_job(
            "check_licenses",
            trigger="cron",
            hour=cfg["license_check_hour"],
        )
        scheduler.reschedule_job(
            "smart_check",
            trigger="cron",
            hour=cfg["smart_check_hour"],
        )
    except Exception as e:
        logger.warning(f"Could not reschedule jobs dynamically: {e}")


def start_scheduler():
    """Start APScheduler with all tasks (blocking)"""

    # Create tables
    Base.metadata.create_all(bind=engine)

    db = _new_session()
    try:
        cfg = _load_scheduler_values(db)
    finally:
        db.close()

    scheduler = BlockingScheduler()

    # Add jobs
    scheduler.add_job(
        sync_job,
        'interval',
        minutes=cfg["monitoring_interval_minutes"],
        args=[monitor_all_firewalls],
        id='monitor_firewalls',
        name='Monitor all firewalls'
    )

    scheduler.add_job(
        sync_job,
        'cron',
        hour=cfg["license_check_hour"],
        args=[check_license_expiry],
        id='check_licenses',
        name='Check license expiry'
    )

    scheduler.add_job(
        sync_job,
        'interval',
        minutes=BACKUP_SCAN_INTERVAL_MINUTES,
        args=[backup_all_firewalls],
        id='backup_firewalls',
        name='Create automatic backups (per firewall schedules)'
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
        'interval',
        minutes=UPDATE_CHECK_INTERVAL_MINUTES,
        args=[check_pending_updates_all_firewalls],
        id='check_pending_updates',
        name='Refresh pending updates for all firewalls'
    )

    scheduler.add_job(
        sync_job,
        'cron',
        hour=cfg["smart_check_hour"],
        args=[smart_check_all_firewalls],
        id='smart_check',
        name='Daily S.M.A.R.T. disk check'
    )

    scheduler.add_job(
        refresh_scheduler_jobs,
        'interval',
        minutes=SCHEDULER_REFRESH_MINUTES,
        args=[scheduler],
        id='refresh_scheduler_jobs',
        name='Refresh scheduler settings from DB'
    )

    logger.info("Scheduler starting...")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")


if __name__ == "__main__":
    start_scheduler()
