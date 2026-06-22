-- PostgreSQL Database Schema for OPNsense CMS

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,
    INDEX idx_email (email),
    INDEX idx_username (username)
);

-- Firewalls table
CREATE TABLE firewalls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_name VARCHAR(255) NOT NULL,
    hostname VARCHAR(255),
    ip VARCHAR(45) NOT NULL,
    api_key VARCHAR(255) NOT NULL,
    api_secret BYTEA NOT NULL,
    verify_ssl BOOLEAN DEFAULT FALSE,
    ssl_cert_path VARCHAR(500),
    license_expiry TIMESTAMP WITH TIME ZONE,
    notify_email VARCHAR(255),
    auto_update BOOLEAN DEFAULT FALSE,
    auto_update_window VARCHAR(20) DEFAULT 'sun:02:00',
    backup_interval VARCHAR(20) DEFAULT 'daily',
    backup_retention INTEGER DEFAULT 30,
    tags JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE,
    last_sync_error TEXT,
    INDEX idx_ip (ip),
    INDEX idx_customer (customer_name)
);

-- Firewall status table
CREATE TABLE firewall_status (
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
    last_error TEXT,
    INDEX idx_firewall_status (firewall_id),
    INDEX idx_checked_at (checked_at DESC)
);

-- Backups table
CREATE TABLE backups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    filepath VARCHAR(500) NOT NULL,
    size_bytes INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    triggered_by VARCHAR(50),
    last_error TEXT,
    INDEX idx_firewall_backups (firewall_id),
    INDEX idx_backup_date (created_at DESC)
);

-- Alerts table
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID REFERENCES firewalls(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    message TEXT NOT NULL,
    email_sent BOOLEAN DEFAULT FALSE,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_firewall_alerts (firewall_id),
    INDEX idx_alert_type (alert_type),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved),
    INDEX idx_created_at (created_at DESC)
);

-- Update history table
CREATE TABLE update_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
    version_before VARCHAR(100),
    version_after VARCHAR(100),
    triggered_by VARCHAR(50) DEFAULT 'manual',
    status VARCHAR(20) DEFAULT 'pending',
    log TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    INDEX idx_firewall_updates (firewall_id),
    INDEX idx_status (status),
    INDEX idx_started_at (started_at DESC)
);

-- License notifications table
CREATE TABLE license_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firewall_id UUID NOT NULL REFERENCES firewalls(id) ON DELETE CASCADE,
    days_remaining INTEGER NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_firewall_licenses (firewall_id),
    INDEX idx_sent_at (sent_at DESC)
);

-- Create indexes for common queries
CREATE INDEX idx_firewall_status_latest ON firewall_status(firewall_id, checked_at DESC);
CREATE INDEX idx_backup_latest ON backups(firewall_id, created_at DESC);
CREATE INDEX idx_alert_unresolved ON alerts(resolved, severity) WHERE resolved = FALSE;
