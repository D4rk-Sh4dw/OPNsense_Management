import logging
import re
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models import Firewall, FirewallStatus, Alert
from app.services.opnsense_api import (
    OPNsenseAPI,
    extract_firmware_version,
    extract_firmware_update_count,
    merge_firmware_info_into_status,
)
from app.services.encryption_service import EncryptionService
from app.services.email_service import EmailService, resolve_firewall_recipients
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _open_alert(db: Session, firewall_id, alert_type: str):
    return db.query(Alert).filter(
        Alert.firewall_id == firewall_id,
        Alert.alert_type == alert_type,
        Alert.resolved == False,
    ).first()


def raise_alert(
    db: Session,
    firewall: Firewall,
    alert_type: str,
    severity: str,
    message: str,
    title: str | None = None,
    send_email: bool = True,
) -> Alert | None:
    """Create a new alert (only if no unresolved one exists) and optionally send email."""
    existing = _open_alert(db, firewall.id, alert_type)
    if existing:
        return existing

    alert = Alert(
        firewall_id=firewall.id,
        alert_type=alert_type,
        severity=severity,
        message=message,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)

    if send_email:
        recipients = resolve_firewall_recipients(firewall, "general")
        if recipients:
            try:
                EmailService.send_generic_alert(
                    customer_name=firewall.customer_name,
                    hostname=firewall.hostname or firewall.ip,
                    notify_email=recipients,
                    severity=severity,
                    title=title or alert_type.replace("_", " ").title(),
                    details=message,
                )
            except Exception as e:
                logger.warning(f"Alert email failed for {firewall.hostname}: {e}")

    return alert


def resolve_alert_if_open(db: Session, firewall_id, alert_type: str):
    open_alert = _open_alert(db, firewall_id, alert_type)
    if open_alert:
        open_alert.resolved = True
        open_alert.resolved_at = datetime.utcnow()
        db.commit()


def _gateway_problems(gw_status: dict) -> list:
    """Return list of (name, status) for gateways that are down/forced-down."""
    if not gw_status:
        return []
    items = gw_status.get("items") if isinstance(gw_status, dict) else None
    if items is None:
        items = gw_status
    if isinstance(items, dict):
        items = list(items.values())
    if not isinstance(items, list):
        return []

    bad = []
    for g in items:
        if not isinstance(g, dict):
            continue
        s = str(g.get("status") or g.get("status_translated") or "").lower()
        if "down" in s or "force_down" in s or "offline" in s:
            bad.append((g.get("name") or g.get("monitor") or "?", s))
    return bad


def _to_float(value):
    """Parse '12.5%' or '12.5' or 12.5 → 12.5"""
    if value is None:
        return None
    try:
        if isinstance(value, str):
            m = re.search(r"[-+]?\d*\.?\d+", value)
            return float(m.group()) if m else None
        return float(value)
    except (ValueError, TypeError):
        return None


def _to_bool(value):
    """Best-effort conversion for API booleans like 1/0, yes/no, running/stopped."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on", "enabled", "running", "up", "ok"}:
            return True
        if normalized in {"0", "false", "no", "off", "disabled", "stopped", "down", "failed", "error"}:
            return False
    return None


def _parse_services(rows: list) -> list:
    """Normalize OPNsense service rows for the UI.

    Different OPNsense versions expose slightly different keys. We keep the
    parser permissive and preserve a compact, stable shape for the frontend.
    """
    parsed = []
    for svc in rows or []:
        if not isinstance(svc, dict):
            continue

        service_id = svc.get("id") or svc.get("service") or svc.get("name") or svc.get("label")
        name = svc.get("name") or svc.get("service") or svc.get("id") or svc.get("label")
        if not name:
            continue

        description = svc.get("description") or svc.get("label") or name
        running = _to_bool(svc.get("running"))

        enabled = None
        if "enabled" in svc:
            enabled = _to_bool(svc.get("enabled"))
        elif "disabled" in svc:
            disabled = _to_bool(svc.get("disabled"))
            enabled = None if disabled is None else not disabled
        elif "active" in svc:
            enabled = _to_bool(svc.get("active"))

        status_text = str(
            svc.get("status")
            or svc.get("state")
            or svc.get("message")
            or ("running" if running is True else "stopped" if running is False else "unknown")
        )

        normalized_status = status_text.strip().lower()
        has_error = False
        if normalized_status:
            has_error = any(token in normalized_status for token in ("fail", "error", "crash"))
            if normalized_status in {"stopped", "down"} and enabled is True:
                has_error = True
        if running is False and enabled is True:
            has_error = True

        parsed.append({
            "service_id": str(service_id),
            "name": str(name),
            "description": str(description),
            "enabled": enabled,
            "running": running,
            "status": status_text,
            "has_error": has_error,
        })

    parsed.sort(key=lambda item: (item["has_error"] is False, item["name"].lower()))
    return parsed


def _parse_memory(resources: dict):
    """Extract RAM usage percentage from systemResources response.

    OPNsense returns shapes like:
      {"memory": {"used": 1234, "total": 8192}}
      or sometimes flat with 'totalmem', 'usedmem'
    """
    if not isinstance(resources, dict):
        return None
    mem = resources.get("memory")
    if isinstance(mem, dict):
        used = _to_float(mem.get("used"))
        total = _to_float(mem.get("total"))
        if used is not None and total and total > 0:
            return round(used / total * 100, 1)
    # flat keys
    used = _to_float(resources.get("usedmem") or resources.get("real_used"))
    total = _to_float(resources.get("totalmem") or resources.get("real_total"))
    if used is not None and total and total > 0:
        return round(used / total * 100, 1)
    return None


def _parse_cpu_from_activity(activity: dict):
    """Extract overall CPU usage from getActivity response.

    The activity endpoint returns a 'headers' dict containing a 'CPU' string like:
      "CPU:  3.2% user,  0.0% nice,  5.1% system,  0.4% interrupt, 91.3% idle"
    """
    if not isinstance(activity, dict):
        return None
    headers = activity.get("headers")
    if isinstance(headers, dict):
        cpu_line = headers.get("CPU") or headers.get("cpu") or ""
    elif isinstance(headers, list):
        cpu_line = " ".join(str(x) for x in headers if "CPU" in str(x))
    else:
        cpu_line = str(activity.get("CPU") or "")

    if cpu_line:
        m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*idle", cpu_line)
        if m:
            idle = float(m.group(1))
            return round(max(0.0, 100.0 - idle), 1)
    return None


def _parse_uptime(system_time: dict):
    """Extract uptime in seconds from systemTime response.

    Returns shapes like {"uptime": "1234"} or {"uptime": 1234} or formatted string.
    """
    if not isinstance(system_time, dict):
        return None
    val = system_time.get("uptime")
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    if isinstance(val, str):
        # numeric string
        if val.isdigit():
            return int(val)
        # parse "5 days 03:14:22" or similar
        days = hours = mins = secs = 0
        m = re.search(r"(\d+)\s*day", val)
        if m:
            days = int(m.group(1))
        m = re.search(r"(\d+):(\d+):(\d+)", val)
        if m:
            hours, mins, secs = map(int, m.groups())
        total = days * 86400 + hours * 3600 + mins * 60 + secs
        return total if total > 0 else None
    return None


class MonitoringService:
    """Service for firewall health monitoring"""

    @staticmethod
    async def check_firewall_connectivity(db: Session, firewall: Firewall) -> bool:
        """Fast online/offline check. Updates `online` in the latest status row in-place.
        Only raises/resolves the offline alert on state transition."""
        prev = (
            db.query(FirewallStatus)
            .filter(FirewallStatus.firewall_id == firewall.id)
            .order_by(FirewallStatus.checked_at.desc())
            .first()
        )
        prev_online = prev.online if prev else None

        try:
            api_secret = EncryptionService.decrypt(firewall.api_secret)
            api = OPNsenseAPI(
                firewall.ip, firewall.api_key, api_secret,
                firewall.verify_ssl, firewall.ssl_cert_path,
            )
            api.timeout = 5
            await api.get_system_information()
            now_online = True
            firewall.last_seen = datetime.utcnow()
            firewall.last_sync_error = None
        except Exception as e:
            now_online = False
            firewall.last_sync_error = str(e)

        if prev is None:
            row = FirewallStatus(
                firewall_id=firewall.id,
                online=now_online,
                checked_at=datetime.utcnow(),
            )
            db.add(row)
        else:
            prev.online = now_online
            prev.checked_at = datetime.utcnow()
            if not now_online:
                prev.last_error = firewall.last_sync_error

        db.commit()

        # Alert only on state transition
        if now_online != prev_online:
            if not now_online:
                raise_alert(
                    db, firewall,
                    alert_type="offline",
                    severity="critical",
                    title="Firewall offline",
                    message=f"Firewall {firewall.hostname or firewall.ip} is not reachable: {firewall.last_sync_error or 'unknown error'}",
                )
            else:
                resolve_alert_if_open(db, firewall.id, "offline")

        return now_online

    @staticmethod
    async def check_firewall_health(
        db: Session,
        firewall: Firewall
    ) -> FirewallStatus:
        """Perform comprehensive health check on firewall"""
        previous_status = (
            db.query(FirewallStatus)
            .filter(FirewallStatus.firewall_id == firewall.id)
            .order_by(FirewallStatus.checked_at.desc())
            .first()
        )
        was_offline = bool(previous_status is not None and previous_status.online is False)

        status = FirewallStatus()
        status.firewall_id = firewall.id
        status.checked_at = datetime.utcnow()

        try:
            api_secret = EncryptionService.decrypt(firewall.api_secret)
            api_client = OPNsenseAPI(
                firewall.ip,
                firewall.api_key,
                api_secret,
                firewall.verify_ssl,
                firewall.ssl_cert_path,
            )

            import asyncio as _asyncio

            # Connectivity check via a cheap call
            await api_client.get_system_information()
            status.online = True
            firewall.last_seen = datetime.utcnow()

            # Firmware status — trigger a fresh repo check first so upgrade_sets /
            # status_msg are populated; otherwise OPNsense returns a stale (often
            # empty) snapshot when the GUI has not been opened recently.
            await _asyncio.sleep(1)
            try:
                try:
                    await api_client.check_firmware_updates()
                except Exception as e:
                    logger.debug(f"firmware/check skipped for {firewall.hostname}: {e}")
                fw_status = await api_client.get_firmware_status()
                try:
                    fw_info = await api_client.get_firmware_info()
                    fw_status = merge_firmware_info_into_status(fw_status, fw_info)
                except Exception as e:
                    logger.debug(f"firmware/info skipped for {firewall.hostname}: {e}")
                status.firmware_version = extract_firmware_version(fw_status)
                status.updates_available = extract_firmware_update_count(fw_status)
            except Exception as e:
                logger.warning(f"Firmware status failed for {firewall.hostname}: {e}")

            # RAM via systemResources
            await _asyncio.sleep(1)
            try:
                resources = await api_client.get_system_resources()
                status.ram_usage = _parse_memory(resources)
            except Exception as e:
                logger.warning(f"systemResources failed for {firewall.hostname}: {e}")

            # CPU via activity (top output)
            await _asyncio.sleep(1)
            try:
                activity = await api_client.get_activity()
                status.cpu_usage = _parse_cpu_from_activity(activity)
            except Exception as e:
                logger.warning(f"getActivity failed for {firewall.hostname}: {e}")

            # Uptime via systemTime
            await _asyncio.sleep(1)
            try:
                tm = await api_client.get_system_time()
                status.uptime_seconds = _parse_uptime(tm)
            except Exception as e:
                logger.warning(f"systemTime failed for {firewall.hostname}: {e}")

            # Gateway status
            await _asyncio.sleep(1)
            try:
                gw_status = await api_client.get_gateway_status()
                status.gateway_status = gw_status
            except Exception as e:
                logger.warning(f"Gateway status failed for {firewall.hostname}: {e}")

            # Service status
            await _asyncio.sleep(1)
            try:
                services = await api_client.get_services_status()
                rows = services.get("rows", []) if isinstance(services, dict) else []
                status.services_status = _parse_services(rows)
                status.pending_services = [
                    svc["name"] for svc in status.services_status
                    if svc.get("enabled") is True and svc.get("running") is False
                ]
            except Exception as e:
                logger.warning(f"Service status failed for {firewall.hostname}: {e}")

            firewall.last_sync_error = None

        except Exception as e:
            logger.error(f"Health check failed for {firewall.hostname}: {e}")
            status.online = False
            status.last_error = str(e)
            firewall.last_sync_error = str(e)

        db.add(status)
        db.commit()
        db.refresh(status)

        if was_offline and status.online:
            try:
                from app.services.update_service import UpdateService

                logger.info(
                    f"Firewall recovered online, refreshing updates for {firewall.hostname or firewall.ip}"
                )
                await UpdateService.refresh_firewall_update_status(db, firewall, trigger_check=True)
            except Exception as e:
                logger.warning(
                    f"Post-recovery update check failed for {firewall.hostname or firewall.ip}: {e}"
                )

        # Post-status alerting (uses fresh status + history)
        try:
            if not status.online:
                raise_alert(
                    db, firewall,
                    alert_type="offline",
                    severity="critical",
                    title="Firewall offline",
                    message=f"Firewall {firewall.hostname or firewall.ip} is not reachable: {status.last_error or 'unknown error'}",
                )
            else:
                resolve_alert_if_open(db, firewall.id, "offline")
                MonitoringService._check_resource_thresholds(db, firewall, status)
                MonitoringService._check_gateway_alerts(db, firewall, status)
                MonitoringService._check_pending_updates(db, firewall, status)
        except Exception as e:
            logger.warning(f"Post-status alerting failed for {firewall.hostname}: {e}")
            db.rollback()

        return status

    @staticmethod
    def _check_resource_thresholds(db: Session, firewall: Firewall, status: FirewallStatus):
        """High-CPU / high-RAM alerts (trigger after N consecutive checks over threshold)."""
        n = max(1, settings.CPU_RAM_CONSECUTIVE_CHECKS)

        for metric, threshold, alert_type, label in (
            ("cpu_usage", settings.CPU_ALERT_THRESHOLD, "high_cpu", "CPU"),
            ("ram_usage", settings.RAM_ALERT_THRESHOLD, "high_ram", "RAM"),
        ):
            recent = (
                db.query(FirewallStatus)
                .filter(FirewallStatus.firewall_id == firewall.id)
                .order_by(FirewallStatus.checked_at.desc())
                .limit(n)
                .all()
            )
            vals = [getattr(s, metric) for s in recent]
            current = getattr(status, metric)

            if len(recent) >= n and all(v is not None and v > threshold for v in vals):
                raise_alert(
                    db, firewall,
                    alert_type=alert_type,
                    severity="warning",
                    title=f"High {label} usage",
                    message=(
                        f"{label} usage above {threshold}% for the last {n} checks "
                        f"(current: {current}%)."
                    ),
                )
            elif current is not None and current <= threshold:
                resolve_alert_if_open(db, firewall.id, alert_type)

    @staticmethod
    def _check_gateway_alerts(db: Session, firewall: Firewall, status: FirewallStatus):
        problems = _gateway_problems(status.gateway_status or {})
        if problems:
            names = ", ".join(f"{n} ({s})" for n, s in problems)
            raise_alert(
                db, firewall,
                alert_type="gateway_offline",
                severity="warning",
                title="Gateway offline",
                message=f"One or more gateways are down: {names}",
            )
        else:
            resolve_alert_if_open(db, firewall.id, "gateway_offline")

    @staticmethod
    def _check_pending_updates(db: Session, firewall: Firewall, status: FirewallStatus):
        if not status.updates_available or status.updates_available <= 0:
            resolve_alert_if_open(db, firewall.id, "updates_pending")
            return

        oldest = (
            db.query(FirewallStatus)
            .filter(
                FirewallStatus.firewall_id == firewall.id,
                FirewallStatus.updates_available > 0,
            )
            .order_by(FirewallStatus.checked_at.asc())
            .first()
        )
        if not oldest:
            return

        age = datetime.utcnow() - oldest.checked_at
        if age >= timedelta(days=settings.PENDING_UPDATE_DAYS):
            raise_alert(
                db, firewall,
                alert_type="updates_pending",
                severity="warning",
                title="Updates pending",
                message=(
                    f"{status.updates_available} update(s) have been available for "
                    f"{age.days} days. Please plan a maintenance window."
                ),
            )


    @staticmethod
    def check_smart_health(
        db: Session,
        firewall: Firewall,
        smart_data: dict
    ) -> list:
        """
        Check S.M.A.R.T. disk health and create alerts if needed

        Args:
            db: Database session
            firewall: Firewall instance
            smart_data: S.M.A.R.T. data from API

        Returns:
            List of created alerts
        """
        problems: list[tuple[str, str, str]] = []  # (severity, device, description)

        try:
            for device_info in smart_data.get("devices", []):
                device = device_info.get("name") or "unknown"
                status = (device_info.get("status") or "").upper()

                if status == "FAILED":
                    problems.append(("critical", device, "S.M.A.R.T. status FAILED"))

                for attr in device_info.get("attributes", []) or []:
                    attr_id = attr.get("id")
                    raw_value = attr.get("raw_value", 0) or 0
                    try:
                        raw_value = int(raw_value)
                    except (TypeError, ValueError):
                        raw_value = 0

                    if attr_id == 5 and raw_value > 0:
                        problems.append(("warning", device, f"{raw_value} reallocated sectors"))
                    elif attr_id == 197 and raw_value > 0:
                        problems.append(("warning", device, f"{raw_value} pending sectors"))
        except Exception as e:
            logger.error(f"S.M.A.R.T. check failed: {e}")
            return []

        if not problems:
            resolve_alert_if_open(db, firewall.id, "smart_error")
            return []

        severity = "critical" if any(p[0] == "critical" for p in problems) else "warning"
        message = "\n".join(f"- {dev}: {desc}" for _, dev, desc in problems)

        alert = raise_alert(
            db, firewall,
            alert_type="smart_error",
            severity=severity,
            title="Disk S.M.A.R.T. issue",
            message="One or more disks reported S.M.A.R.T. problems:\n" + message,
        )
        return [alert] if alert else []


    @staticmethod
    def get_dashboard_summary(db: Session) -> dict:
        """Get dashboard summary statistics based on the latest status per firewall"""

        total_fw = db.query(Firewall).count()
        firewalls = db.query(Firewall).all()

        online_count = 0
        pending_updates = 0

        for fw in firewalls:
            latest = db.query(FirewallStatus).filter(
                FirewallStatus.firewall_id == fw.id
            ).order_by(FirewallStatus.checked_at.desc()).first()

            if latest and latest.online:
                online_count += 1
            if latest and (latest.updates_available or 0) > 0:
                pending_updates += 1

        offline_count = total_fw - online_count

        critical_alerts = db.query(Alert).filter(
            Alert.severity == "critical",
            Alert.resolved == False
        ).count()

        return {
            "total_firewalls": total_fw,
            "online_count": online_count,
            "offline_count": offline_count,
            "pending_updates": pending_updates,
            "critical_alerts": critical_alerts,
        }

    @staticmethod
    def get_firewall_quick_status(db: Session, limit: int = 100) -> list:
        """Get quick status overview of firewalls for dashboard"""

        firewalls = db.query(Firewall).limit(limit).all()
        results = []

        for fw in firewalls:
            status = db.query(FirewallStatus).filter(
                FirewallStatus.firewall_id == fw.id
            ).order_by(FirewallStatus.checked_at.desc()).first()

            alert = db.query(Alert).filter(
                Alert.firewall_id == fw.id,
                Alert.resolved == False,
                Alert.severity == "critical"
            ).first()

            results.append({
                "id": fw.id,
                "customer_name": fw.customer_name,
                "hostname": fw.hostname,
                "ip": fw.ip,
                "tags": fw.tags or [],
                "online": status.online if status else None,
                "firmware_version": status.firmware_version if status else None,
                "updates_available": status.updates_available if status else 0,
                "cpu_usage": status.cpu_usage if status else None,
                "ram_usage": status.ram_usage if status else None,
                "last_seen": fw.last_seen,
                "critical_alert": alert.message if alert else None
            })

        return results
