-- PostgreSQL Database Schema for OPNsense CMS
-- Note: Tables are normally created automatically by SQLAlchemy at startup.
-- This file documents the schema and can be used for manual provisioning.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Firewalls table
CREATE TABLE IF NOT EXISTS firewalls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_name VARCHAR(255) NOT NULL,
    hostname VARCHAR(255),
    ip VARCHAR(45) NOT NULL,
    api_key VARCHAR(255) NOT NULL,
    api_secret BYTEA NOT NULL,
    verify_ssl BOOLEAN DEFAULT FALSE,
    ssl_cert_path VARCHAR(500),
    license_expiry TIMESTAMP WITH TIME ZONE,
    license_type VARCHAR(20),
    notify_email VARCHAR(255),
    auto_update BOOLEAN DEFAULT FALSE,
    auto_update_window VARCHAR(20) DEFAULT 'sun:02:00',
    backup_interval VARCHAR(20) DEFAULT 'daily',
    backup_time VARCHAR(5) DEFAULT '01:00',
    backup_weekday INTEGER DEFAULT 6,
    backup_monthday INTEGER DEFAULT 1,
    backup_retention INTEGER DEFAULT 30,
    tags JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE,
    last_sync_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_firewalls_ip ON firewalls(ip);
CREATE INDEX IF NOT EXISTS idx_firewalls_customer ON firewalls(customer_name);

-- Firewall tag catalog table
CREATE TABLE IF NOT EXISTS firewall_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_firewall_tags_name ON firewall_tags(name);

-- Firewall status table
CREATE TABLE IF NOT EXISTS firewall_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    online BOOLEAN,
    firmware_version VARCHAR(100),
    updates_available INTEGER DEFAULT 0,
    cpu_usage FLOAT,
    ram_usage FLOAT,
    uptime_seconds BIGINT,
    gateway_status JSONB,
    pending_services JSONB DEFAULT '[]'::jsonb,
    services_status JSONB DEFAULT '[]'::jsonb,
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_firewall_status_fk ON firewall_status(firewall_id);
CREATE INDEX IF NOT EXISTS idx_firewall_status_latest ON firewall_status(firewall_id, checked_at DESC);

-- Backups table
CREATE TABLE IF NOT EXISTS backups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    filepath VARCHAR(500) NOT NULL,
    size_bytes BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    triggered_by VARCHAR(50),
    last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_fk ON backups(firewall_id);
CREATE INDEX IF NOT EXISTS idx_backups_latest ON backups(firewall_id, created_at DESC);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID REFERENCES firewalls(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    message TEXT NOT NULL,
    email_sent BOOLEAN DEFAULT FALSE,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_fk ON alerts(firewall_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON alerts(resolved, severity) WHERE resolved = FALSE;

-- Update history table
CREATE TABLE IF NOT EXISTS update_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
    version_before VARCHAR(100),
    version_after VARCHAR(100),
    triggered_by VARCHAR(50) DEFAULT 'manual',
    status VARCHAR(20) DEFAULT 'pending',
    log TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_update_history_fk ON update_history(firewall_id);
CREATE INDEX IF NOT EXISTS idx_update_history_status ON update_history(status);
CREATE INDEX IF NOT EXISTS idx_update_history_started ON update_history(started_at DESC);

-- License notifications table
CREATE TABLE IF NOT EXISTS license_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
    days_remaining INTEGER NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_license_notif_fk ON license_notifications(firewall_id);
CREATE INDEX IF NOT EXISTS idx_license_notif_sent ON license_notifications(sent_at DESC);

-- Global scheduler settings (singleton id=1)
CREATE TABLE IF NOT EXISTS scheduler_settings (
    id INTEGER PRIMARY KEY,
    monitoring_interval_seconds INTEGER DEFAULT 10,
    monitoring_interval_minutes INTEGER DEFAULT 5,
    license_check_hour INTEGER DEFAULT 2,
    smart_check_hour INTEGER DEFAULT 3,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
