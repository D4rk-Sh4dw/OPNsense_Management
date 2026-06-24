import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, Integer, BigInteger, Float, JSON, Text, ForeignKey, TIMESTAMP, LargeBinary
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class User(Base):
    """CMS user accounts"""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)


class Firewall(Base):
    """Managed OPNsense firewall instances"""
    __tablename__ = "firewalls"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_name = Column(String(255), nullable=False)
    hostname = Column(String(255))
    ip = Column(String(45), nullable=False)  # IPv4 or IPv6
    api_key = Column(String(255), nullable=False)
    api_secret = Column(LargeBinary, nullable=False)  # Encrypted
    verify_ssl = Column(Boolean, default=False)
    ssl_cert_path = Column(String(500), nullable=True)
    license_expiry = Column(DateTime, nullable=True)
    notify_email = Column(String(255))  # legacy: single email (kept for backward compat)
    notify_emails_general = Column(Text, nullable=True)  # CSV of recipients for general alerts
    notify_emails_license = Column(Text, nullable=True)  # CSV of recipients for license alerts
    license_alert_days = Column(String(100), nullable=True)  # CSV of day thresholds e.g. "30,14,7,1"
    auto_update = Column(Boolean, default=False)
    auto_update_window = Column(String(20), default="sun:02:00")  # day:HH:MM format
    backup_interval = Column(String(20), default="daily")  # "hourly", "daily", "weekly", "monthly"
    backup_time = Column(String(5), default="01:00")  # HH:MM
    backup_weekday = Column(Integer, default=6)  # 0=Mon ... 6=Sun
    backup_monthday = Column(Integer, default=1)  # 1..28/31
    backup_retention = Column(Integer, default=30)  # retention in days
    tags = Column(JSON, default=list)
    notes = Column(Text)
    license_type = Column(String(20), nullable=True)  # "community", "business", None
    location_address = Column(Text, nullable=True)   # Human-readable address for geomap
    location_lat = Column(Float, nullable=True)      # Latitude (set via geocoding)
    location_lon = Column(Float, nullable=True)      # Longitude (set via geocoding)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, nullable=True)
    last_sync_error = Column(Text, nullable=True)


class FirewallStatus(Base):
    """Latest monitoring data for each firewall"""
    __tablename__ = "firewall_status"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firewall_id = Column(UUID(as_uuid=True), ForeignKey("firewalls.id"), nullable=False, index=True)
    checked_at = Column(DateTime, default=datetime.utcnow)
    online = Column(Boolean)
    firmware_version = Column(String(100))
    updates_available = Column(Integer, default=0)
    cpu_usage = Column(Float)
    ram_usage = Column(Float)
    uptime_seconds = Column(BigInteger)
    gateway_status = Column(JSON)
    pending_services = Column(JSON, default=list)
    services_status = Column(JSON, default=list)
    last_error = Column(Text, nullable=True)


class Backup(Base):
    """Firewall backup records"""
    __tablename__ = "backups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firewall_id = Column(UUID(as_uuid=True), ForeignKey("firewalls.id"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    filepath = Column(String(500), nullable=False)
    size_bytes = Column(BigInteger)
    created_at = Column(DateTime, default=datetime.utcnow)
    triggered_by = Column(String(50))  # "manual", "auto", "pre-update"
    last_error = Column(Text, nullable=True)


class Alert(Base):
    """System alerts and alarms"""
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firewall_id = Column(UUID(as_uuid=True), ForeignKey("firewalls.id"), index=True)
    alert_type = Column(String(50), nullable=False)  # "license_expiry", "update_failed", "offline", "smart_error", etc.
    severity = Column(String(20), default="info")  # "info", "warning", "critical"
    message = Column(Text, nullable=False)
    email_sent = Column(Boolean, default=False)
    resolved = Column(Boolean, default=False)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class UpdateHistory(Base):
    """Firmware update tracking"""
    __tablename__ = "update_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firewall_id = Column(UUID(as_uuid=True), ForeignKey("firewalls.id"), nullable=False, index=True)
    version_before = Column(String(100))
    version_after = Column(String(100))
    triggered_by = Column(String(50), default="manual")  # "manual" or "auto"
    status = Column(String(20), default="pending")  # "success", "failed", "pending", "in-progress"
    log = Column(Text)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class LicenseNotification(Base):
    """Track sent license expiry notifications"""
    __tablename__ = "license_notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firewall_id = Column(UUID(as_uuid=True), ForeignKey("firewalls.id"), nullable=False, index=True)
    days_remaining = Column(Integer, nullable=False)  # 14, 7, or 1
    sent_at = Column(DateTime, default=datetime.utcnow)


class SchedulerSettings(Base):
    """Global scheduler settings editable via GUI."""
    __tablename__ = "scheduler_settings"

    id = Column(Integer, primary_key=True, default=1)
    monitoring_interval_seconds = Column(Integer, default=10)
    monitoring_interval_minutes = Column(Integer, default=5)
    license_check_hour = Column(Integer, default=2)
    smart_check_hour = Column(Integer, default=3)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailTemplate(Base):
    """Editable e-mail templates with placeholder support."""
    __tablename__ = "email_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(20), default="general")  # "general" | "license"
    subject = Column(String(500), nullable=False)
    html_body = Column(Text, nullable=False)
    plain_body = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailBrandingSettings(Base):
    """Singleton row holding brand assets used in all e-mails."""
    __tablename__ = "email_branding_settings"

    id = Column(Integer, primary_key=True, default=1)
    brand_name = Column(String(255), default="OPNsense CMS")
    logo_url = Column(Text, nullable=True)  # URL or data: URI
    primary_color = Column(String(20), default="#4f46e5")
    accent_color = Column(String(20), default="#3b82f6")
    footer_text = Column(Text, nullable=True)
    reply_to = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
