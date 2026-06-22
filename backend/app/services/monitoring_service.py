import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models import Firewall, FirewallStatus, Alert
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService

logger = logging.getLogger(__name__)


class MonitoringService:
    """Service for firewall health monitoring"""

    @staticmethod
    async def check_firewall_health(
        db: Session,
        firewall: Firewall
    ) -> FirewallStatus:
        """
        Perform comprehensive health check on firewall

        Args:
            db: Database session
            firewall: Firewall instance

        Returns:
            Updated FirewallStatus record
        """
        status = FirewallStatus()
        status.firewall_id = firewall.id
        status.checked_at = datetime.utcnow()

        try:
            # Decrypt API secret (decrypt() already returns str)
            api_secret = EncryptionService.decrypt(firewall.api_secret)

            # Initialize API client
            api_client = OPNsenseAPI(
                firewall.ip,
                firewall.api_key,
                api_secret,
                firewall.verify_ssl,
                firewall.ssl_cert_path
            )

            # Check connectivity
            status.online = True
            firewall.last_seen = datetime.utcnow()

            # Get firmware status
            try:
                fw_status = await api_client.get_firmware_status()
                status.firmware_version = fw_status.get("product_version")
                status.updates_available = fw_status.get("updates", 0)
            except Exception as e:
                logger.warning(f"Failed to get firmware status for {firewall.hostname}: {e}")

            # Get system health
            try:
                health = await api_client.get_system_health()
                status.cpu_usage = health.get("cpu", [0])[0]
                status.ram_usage = health.get("memory", {}).get("used_percent")
                status.uptime_seconds = health.get("uptime")
            except Exception as e:
                logger.warning(f"Failed to get system health for {firewall.hostname}: {e}")

            # Get gateway status
            try:
                gw_status = await api_client.get_gateway_status()
                status.gateway_status = gw_status
            except Exception as e:
                logger.warning(f"Failed to get gateway status for {firewall.hostname}: {e}")

            # Get service status
            try:
                services = await api_client.get_services_status()
                # Extract running services
                status.pending_services = [
                    svc for svc in services.get("services", [])
                    if svc.get("status") != "running"
                ]
            except Exception as e:
                logger.warning(f"Failed to get service status for {firewall.hostname}: {e}")

            # Update last sync error
            firewall.last_sync_error = None

        except Exception as e:
            logger.error(f"Health check failed for {firewall.hostname}: {e}")
            status.online = False
            status.last_error = str(e)
            firewall.last_sync_error = str(e)

            # Create offline alert
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

        # Save status to database
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
    def get_firewall_quick_status(db: Session, limit: int = 10) -> list:
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
