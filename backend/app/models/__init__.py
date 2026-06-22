import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, Integer, Float, JSON, Text, ForeignKey, TIMESTAMP, LargeBinary
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
    notify_email = Column(String(255))
    auto_update = Column(Boolean, default=False)
    auto_update_window = Column(String(20), default="sun:02:00")  # day:HH:MM format
    backup_interval = Column(String(20), default="daily")  # "daily" or "weekly"
    backup_retention = Column(Integer, default=30)
    tags = Column(JSON, default=list)
    notes = Column(Text)
    license_type = Column(String(20), nullable=True)  # "community", "business", None
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
    uptime_seconds = Column(Integer)
    gateway_status = Column(JSON)
    pending_services = Column(JSON, default=list)
    last_error = Column(Text, nullable=True)


class Backup(Base):
    """Firewall backup records"""
    __tablename__ = "backups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firewall_id = Column(UUID(as_uuid=True), ForeignKey("firewalls.id"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    filepath = Column(String(500), nullable=False)
    size_bytes = Column(Integer)
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
