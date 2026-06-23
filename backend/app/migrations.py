"""
Lightweight schema migrations executed at app startup.
We deliberately avoid Alembic for this project — each function is idempotent and
uses IF NOT EXISTS / IF EXISTS guards.
"""
import logging
from sqlalchemy import text
from app.database import engine, SessionLocal
from app.models import EmailTemplate, EmailBrandingSettings

logger = logging.getLogger(__name__)


_ALTER_STATEMENTS = [
    "ALTER TABLE firewalls ADD COLUMN IF NOT EXISTS notify_emails_general TEXT",
    "ALTER TABLE firewalls ADD COLUMN IF NOT EXISTS notify_emails_license TEXT",
    "ALTER TABLE firewalls ADD COLUMN IF NOT EXISTS license_alert_days VARCHAR(100)",
]


def _apply_alters() -> None:
    with engine.begin() as conn:
        for stmt in _ALTER_STATEMENTS:
            try:
                conn.execute(text(stmt))
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Migration failed for `{stmt}`: {e}")


_DEFAULT_TEMPLATES = [
    {
        "key": "license_expiry",
        "name": "License Expiry Warning",
        "category": "license",
        "subject": "[{brand_name}] License expires in {days_remaining} days - {customer_name}",
        "html_body": (
            "<h2 style=\"color:{primary_color};\">License Expiry Warning</h2>"
            "<p><strong>Customer:</strong> {customer_name}</p>"
            "<p><strong>Firewall:</strong> {hostname}</p>"
            "<p><strong>Expiry date:</strong> {expiry_date}</p>"
            "<p><strong style=\"color:#d9534f;\">Days remaining:</strong> {days_remaining}</p>"
            "<p>Please renew the license to avoid a service interruption.</p>"
        ),
        "plain_body": (
            "License Expiry Warning\n\n"
            "Customer: {customer_name}\n"
            "Firewall: {hostname}\n"
            "Expiry date: {expiry_date}\n"
            "Days remaining: {days_remaining}\n\n"
            "Please renew the license to avoid a service interruption."
        ),
    },
    {
        "key": "update_failed",
        "name": "Firmware Update Failed",
        "category": "general",
        "subject": "[{brand_name}] Update failed - {customer_name}",
        "html_body": (
            "<h2 style=\"color:#d9534f;\">Firmware Update Failed</h2>"
            "<p><strong>Customer:</strong> {customer_name}</p>"
            "<p><strong>Firewall:</strong> {hostname}</p>"
            "<p><strong>Error:</strong> {error_message}</p>"
            "<p>Please review the update and retry manually if needed.</p>"
        ),
        "plain_body": (
            "Firmware Update Failed\n\n"
            "Customer: {customer_name}\n"
            "Firewall: {hostname}\n"
            "Error: {error_message}"
        ),
    },
    {
        "key": "offline",
        "name": "Firewall Offline",
        "category": "general",
        "subject": "[{brand_name}] Firewall offline - {customer_name}",
        "html_body": (
            "<h2 style=\"color:#d9534f;\">Firewall Offline</h2>"
            "<p><strong>Customer:</strong> {customer_name}</p>"
            "<p><strong>Firewall:</strong> {hostname}</p>"
            "<p>The firewall is not responding. Please verify connectivity and status.</p>"
        ),
        "plain_body": (
            "Firewall Offline\n\n"
            "Customer: {customer_name}\n"
            "Firewall: {hostname}\n\n"
            "The firewall is not responding."
        ),
    },
    {
        "key": "smart_error",
        "name": "Disk S.M.A.R.T. Error",
        "category": "general",
        "subject": "[{brand_name}] Disk health critical - {customer_name}",
        "html_body": (
            "<h2 style=\"color:#d9534f;\">Disk S.M.A.R.T. Error</h2>"
            "<p><strong>Customer:</strong> {customer_name}</p>"
            "<p><strong>Firewall:</strong> {hostname}</p>"
            "<p><strong>Device:</strong> {device}</p>"
            "<p><strong>Status:</strong> {status}</p>"
            "<p>The disk may be failing. Plan replacement immediately.</p>"
        ),
        "plain_body": (
            "Disk S.M.A.R.T. Error\n\n"
            "Customer: {customer_name}\n"
            "Firewall: {hostname}\n"
            "Device: {device}\n"
            "Status: {status}"
        ),
    },
    {
        "key": "generic",
        "name": "Generic Alert",
        "category": "general",
        "subject": "[{brand_name}] {title} - {customer_name}",
        "html_body": (
            "<h2 style=\"color:{primary_color};\">{title}</h2>"
            "<p><strong>Customer:</strong> {customer_name}</p>"
            "<p><strong>Firewall:</strong> {hostname}</p>"
            "<p><strong>Severity:</strong> {severity}</p>"
            "<hr/>"
            "<p style=\"white-space:pre-wrap;\">{details}</p>"
        ),
        "plain_body": (
            "{title}\n\n"
            "Customer: {customer_name}\n"
            "Firewall: {hostname}\n"
            "Severity: {severity}\n\n"
            "{details}"
        ),
    },
]


def _seed_templates() -> None:
    db = SessionLocal()
    try:
        for spec in _DEFAULT_TEMPLATES:
            existing = db.query(EmailTemplate).filter(EmailTemplate.key == spec["key"]).first()
            if not existing:
                db.add(EmailTemplate(**spec))
        db.commit()
    finally:
        db.close()


def _seed_branding() -> None:
    db = SessionLocal()
    try:
        if not db.query(EmailBrandingSettings).first():
            db.add(EmailBrandingSettings(id=1))
            db.commit()
    finally:
        db.close()


def run() -> None:
    """Entrypoint called from FastAPI lifespan."""
    try:
        _apply_alters()
        _seed_templates()
        _seed_branding()
    except Exception as e:  # noqa: BLE001
        logger.exception(f"Startup migrations failed: {e}")
