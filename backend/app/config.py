from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings from environment variables"""

    # App
    APP_NAME: str = "OPNsense CMS"
    DEBUG: bool = False
    SECRET_KEY: str = "your-secret-key-min-32-chars-change-in-production"

    # Database
    DATABASE_URL: str = "postgresql://cms:password@localhost:5432/opnsense_cms"

    # API
    API_PREFIX: str = "/api"
    API_VERSION: str = "v1"

    # JWT
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # SMTP
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 587
    SMTP_USER: str = "cms@example.com"
    SMTP_PASSWORD: str = "password"
    SMTP_FROM: str = "cms@example.com"
    SMTP_USE_TLS: bool = True

    # OPNsense
    VERIFY_SSL: bool = False
    POLLING_INTERVAL_SECONDS: int = 300  # 5 minutes
    REQUEST_TIMEOUT_SECONDS: int = 30

    # Backup
    BACKUP_RETENTION_COUNT: int = 30
    BACKUP_DIRECTORY: str = "./backups"

    # Scheduling
    LICENSE_CHECK_HOUR: int = 2  # 2 AM daily
    MONITORING_INTERVAL_MINUTES: int = 5
    SMART_CHECK_HOUR: int = 3  # 3 AM daily
    UPDATE_CHECK_INTERVAL_MINUTES: int = 30

    # License alerting (CSV of day thresholds, global default if firewall has no override)
    LICENSE_ALERT_DAYS: str = "30,14,7,1"

    # Alerting thresholds
    CPU_ALERT_THRESHOLD: int = 90       # percent
    RAM_ALERT_THRESHOLD: int = 90       # percent
    CPU_RAM_CONSECUTIVE_CHECKS: int = 3  # how many checks in a row before alerting
    PENDING_UPDATE_DAYS: int = 7        # alert when updates have been available for N days

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings():
    """Get cached settings instance"""
    return Settings()
