from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime
from typing import Optional, List
from uuid import UUID


# ===== User Schemas =====
class UserBase(BaseModel):
    email: EmailStr
    username: str


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=8)


class UserResponse(UserBase):
    id: UUID
    is_admin: bool
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime]

    class Config:
        from_attributes = True


# ===== Firewall Schemas =====
class FirewallBase(BaseModel):
    customer_name: str
    hostname: Optional[str] = None
    ip: str
    notify_email: Optional[EmailStr] = None
    auto_update: bool = False
    auto_update_window: str = "sun:02:00"
    backup_interval: str = "daily"
    backup_retention: int = 30
    tags: Optional[List[str]] = []
    notes: Optional[str] = None

    @field_validator("notify_email", mode="before")
    @classmethod
    def empty_str_to_none_email(cls, v):
        return None if v == "" else v

    @field_validator("hostname", "notes", mode="before")
    @classmethod
    def empty_str_to_none_str(cls, v):
        return None if v == "" else v


class FirewallCreate(FirewallBase):
    api_key: str
    api_secret: str
    verify_ssl: bool = False
    ssl_cert_path: Optional[str] = None
    license_expiry: Optional[datetime] = None
    license_type: Optional[str] = None   # "community" | "business" | None

    @field_validator("license_expiry", mode="before")
    @classmethod
    def empty_str_to_none_date(cls, v):
        return None if v == "" else v


class FirewallUpdate(BaseModel):
    customer_name: Optional[str] = None
    hostname: Optional[str] = None
    ip: Optional[str] = None
    notify_email: Optional[EmailStr] = None
    auto_update: Optional[bool] = None
    auto_update_window: Optional[str] = None
    backup_interval: Optional[str] = None
    backup_retention: Optional[int] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    license_expiry: Optional[datetime] = None
    license_type: Optional[str] = None

    @field_validator("notify_email", mode="before")
    @classmethod
    def empty_str_to_none_email(cls, v):
        return None if v == "" else v

    @field_validator("license_expiry", mode="before")
    @classmethod
    def empty_str_to_none_date(cls, v):
        return None if v == "" else v


class FirewallResponse(FirewallBase):
    id: UUID
    api_key: str
    verify_ssl: bool
    ssl_cert_path: Optional[str]
    license_expiry: Optional[datetime]
    license_type: Optional[str]
    created_at: datetime
    last_seen: Optional[datetime]
    last_sync_error: Optional[str]

    class Config:
        from_attributes = True


class FirewallDetailedResponse(FirewallResponse):
    """Firewall with related status and recent backups"""
    status: Optional['FirewallStatusResponse'] = None
    recent_backups: Optional[List['BackupResponse']] = []
    recent_alerts: Optional[List['AlertResponse']] = []


# ===== Firewall Status Schemas =====
class FirewallStatusResponse(BaseModel):
    id: UUID
    firewall_id: UUID
    checked_at: datetime
    online: bool
    firmware_version: Optional[str]
    updates_available: int
    cpu_usage: Optional[float]
    ram_usage: Optional[float]
    uptime_seconds: Optional[int]
    gateway_status: Optional[dict]
    pending_services: Optional[List[str]]
    last_error: Optional[str]

    class Config:
        from_attributes = True


# ===== Backup Schemas =====
class BackupCreate(BaseModel):
    triggered_by: str = "manual"


class BackupResponse(BaseModel):
    id: UUID
    firewall_id: UUID
    filename: str
    filepath: str
    size_bytes: Optional[int]
    created_at: datetime
    triggered_by: str
    last_error: Optional[str]

    class Config:
        from_attributes = True


# ===== Alert Schemas =====
class AlertResponse(BaseModel):
    id: UUID
    firewall_id: Optional[UUID]
    alert_type: str
    severity: str
    message: str
    email_sent: bool
    resolved: bool
    resolved_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ===== Update History Schemas =====
class UpdateHistoryResponse(BaseModel):
    id: UUID
    firewall_id: UUID
    version_before: Optional[str]
    version_after: Optional[str]
    triggered_by: str
    status: str
    log: Optional[str]
    started_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ===== Dashboard Schemas =====
class DashboardSummary(BaseModel):
    total_firewalls: int
    online_count: int
    offline_count: int
    pending_updates: int
    critical_alerts: int


class FirewallQuickStatus(BaseModel):
    id: UUID
    customer_name: str
    hostname: Optional[str] = None
    ip: str
    online: Optional[bool] = None
    firmware_version: Optional[str] = None
    updates_available: int = 0
    cpu_usage: Optional[float] = None
    ram_usage: Optional[float] = None
    last_seen: Optional[datetime] = None
    critical_alert: Optional[str] = None


# Forward references for recursive models
FirewallDetailedResponse.model_rebuild()
