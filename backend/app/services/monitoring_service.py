import logging
import re
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models import Firewall, FirewallStatus, Alert
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService

logger = logging.getLogger(__name__)


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
    async def check_firewall_health(
        db: Session,
        firewall: Firewall
    ) -> FirewallStatus:
        """Perform comprehensive health check on firewall"""
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

            # Connectivity check via a cheap call
            await api_client.get_system_information()
            status.online = True
            firewall.last_seen = datetime.utcnow()

            # Firmware status
            try:
                fw_status = await api_client.get_firmware_status()
                status.firmware_version = fw_status.get("product_version")
                status.updates_available = int(fw_status.get("updates", 0) or 0)
            except Exception as e:
                logger.warning(f"Firmware status failed for {firewall.hostname}: {e}")

            # RAM via systemResources
            try:
                resources = await api_client.get_system_resources()
                status.ram_usage = _parse_memory(resources)
            except Exception as e:
                logger.warning(f"systemResources failed for {firewall.hostname}: {e}")

            # CPU via activity (top output)
            try:
                activity = await api_client.get_activity()
                status.cpu_usage = _parse_cpu_from_activity(activity)
            except Exception as e:
                logger.warning(f"getActivity failed for {firewall.hostname}: {e}")

            # Uptime via systemTime
            try:
                tm = await api_client.get_system_time()
                status.uptime_seconds = _parse_uptime(tm)
            except Exception as e:
                logger.warning(f"systemTime failed for {firewall.hostname}: {e}")

            # Gateway status
            try:
                gw_status = await api_client.get_gateway_status()
                status.gateway_status = gw_status
            except Exception as e:
                logger.warning(f"Gateway status failed for {firewall.hostname}: {e}")

            # Service status
            try:
                services = await api_client.get_services_status()
                rows = services.get("rows", []) if isinstance(services, dict) else []
                status.pending_services = [
                    svc.get("name") for svc in rows if not svc.get("running")
                ]
            except Exception as e:
                logger.warning(f"Service status failed for {firewall.hostname}: {e}")

            firewall.last_sync_error = None

        except Exception as e:
            logger.error(f"Health check failed for {firewall.hostname}: {e}")
            status.online = False
            status.last_error = str(e)
            firewall.last_sync_error = str(e)

            existing_alert = db.query(Alert).filter(
                Alert.firewall_id == firewall.id,
                Alert.alert_type == "offline",
                Alert.resolved == False
            ).first()

            if not existing_alert:
                alert = Alert(
                    firewall_id=firewall.id,
                    alert_type="offline",
                    severity="critical",
                    message=f"Firewall {firewall.hostname} is offline: {str(e)}"
                )
                db.add(alert)

        db.add(status)
        db.commit()
        return status

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
        alerts = []

        try:
            # Check each device
            for device_info in smart_data.get("devices", []):
                device = device_info.get("name")
                status = device_info.get("status")

                # Check for FAILED status
                if status == "FAILED":
                    alert = Alert(
                        firewall_id=firewall.id,
                        alert_type="smart_error",
                        severity="critical",
                        message=f"S.M.A.R.T. Error on device {device}: Status FAILED"
                    )
                    db.add(alert)
                    alerts.append(alert)

                # Check critical attributes
                for attr in device_info.get("attributes", []):
                    attr_id = attr.get("id")
                    attr_name = attr.get("name")
                    raw_value = attr.get("raw_value", 0)

                    # Check known critical attributes
                    if attr_id == 5 and raw_value > 0:  # Reallocated Sectors
                        alert = Alert(
                            firewall_id=firewall.id,
                            alert_type="smart_error",
                            severity="warning",
                            message=f"S.M.A.R.T. Warning: {device} has {raw_value} reallocated sectors"
                        )
                        db.add(alert)
                        alerts.append(alert)

                    elif attr_id == 197 and raw_value > 0:  # Pending Sectors
                        alert = Alert(
                            firewall_id=firewall.id,
                            alert_type="smart_error",
                            severity="warning",
                            message=f"S.M.A.R.T. Warning: {device} has pending sector errors"
                        )
                        db.add(alert)
                        alerts.append(alert)

            db.commit()

        except Exception as e:
            logger.error(f"S.M.A.R.T. check failed: {e}")

        return alerts

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
                "online": status.online if status else None,
                "firmware_version": status.firmware_version if status else None,
                "updates_available": status.updates_available if status else 0,
                "cpu_usage": status.cpu_usage if status else None,
                "ram_usage": status.ram_usage if status else None,
                "last_seen": fw.last_seen,
                "critical_alert": alert.message if alert else None
            })

        return results
