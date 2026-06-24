import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall, FirewallStatus, Alert
from app.schemas import (
    FirewallCreate,
    FirewallUpdate,
    FirewallResponse,
    FirewallDetailedResponse,
    FirewallStatusResponse,
    BackupResponse,
    AlertResponse,
    DashboardSummary,
    FirewallQuickStatus,
)
from app.services.encryption_service import EncryptionService
from app.services.monitoring_service import MonitoringService
from app.services.opnsense_api import OPNsenseAPI

import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall, FirewallStatus, Alert
from app.schemas import (
    FirewallCreate,
    FirewallUpdate,
    FirewallResponse,
    FirewallDetailedResponse,
    FirewallStatusResponse,
    BackupResponse,
    AlertResponse,
    DashboardSummary,
    FirewallQuickStatus,
)
from app.services.encryption_service import EncryptionService
from app.services.monitoring_service import MonitoringService
from app.services.opnsense_api import OPNsenseAPI

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/firewalls", tags=["firewalls"])


@router.get("/map")
async def get_map_data(db: Session = Depends(get_db)):
    """Return all firewalls with coordinates and latest alert state for the geomap."""
    from app.models import Backup
    firewalls = db.query(Firewall).all()
    result = []
    for fw in firewalls:
        latest_status = (
            db.query(FirewallStatus)
            .filter(FirewallStatus.firewall_id == fw.id)
            .order_by(FirewallStatus.checked_at.desc())
            .first()
        )
        open_alerts = (
            db.query(Alert)
            .filter(Alert.firewall_id == fw.id, Alert.resolved == False)
            .order_by(Alert.created_at.desc())
            .all()
        )
        latest_backup = (
            db.query(Backup)
            .filter(Backup.firewall_id == fw.id)
            .order_by(Backup.created_at.desc())
            .first()
        )
        result.append({
            "id": str(fw.id),
            "customer_name": fw.customer_name,
            "hostname": fw.hostname or fw.ip,
            "ip": fw.ip,
            "location_address": fw.location_address,
            "location_lat": fw.location_lat,
            "location_lon": fw.location_lon,
            "online": latest_status.online if latest_status else None,
            "checked_at": latest_status.checked_at.isoformat() if latest_status and latest_status.checked_at else None,
            "firmware_version": latest_status.firmware_version if latest_status else None,
            "updates_available": latest_status.updates_available if latest_status else 0,
            "cpu_usage": latest_status.cpu_usage if latest_status else None,
            "ram_usage": latest_status.ram_usage if latest_status else None,
            "license_type": fw.license_type,
            "license_expiry": fw.license_expiry.isoformat() if fw.license_expiry else None,
            "last_backup": latest_backup.created_at.isoformat() if latest_backup else None,
            "alerts": [
                {
                    "id": str(a.id),
                    "type": a.alert_type,
                    "severity": a.severity,
                    "message": a.message,
                }
                for a in open_alerts
            ],
        })
    return result
        })
    return result


@router.post("/{firewall_id}/geocode")
async def geocode_firewall(
    firewall_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    """Geocode an address string via Nominatim and store lat/lon on the firewall."""
    import httpx

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    address = (payload.get("address") or "").strip()
    if not address:
        raise HTTPException(status_code=400, detail="address is required")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": address, "format": "json", "limit": 1},
                headers={"User-Agent": "OPNsense-CMS/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()
        if not data:
            raise HTTPException(status_code=404, detail=f"No geocoding result for '{address}'")
        hit = data[0]
        firewall.location_address = address
        firewall.location_lat = float(hit["lat"])
        firewall.location_lon = float(hit["lon"])
        db.commit()
        return {
            "location_address": address,
            "location_lat": firewall.location_lat,
            "location_lon": firewall.location_lon,
            "display_name": hit.get("display_name"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Geocoding failed: {e}")


@router.get("", response_model=List[FirewallResponse])
async def list_firewalls(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100
):
    """List all managed firewalls"""

    firewalls = db.query(Firewall).offset(skip).limit(limit).all()
    return firewalls


@router.post("", response_model=FirewallResponse, status_code=status.HTTP_201_CREATED)
async def create_firewall(
    firewall_data: FirewallCreate,
    db: Session = Depends(get_db)
):
    """Add a new firewall to manage"""

    # Encrypt API secret
    encrypted_secret = EncryptionService.encrypt(firewall_data.api_secret)

    firewall = Firewall(
        customer_name=firewall_data.customer_name,
        hostname=firewall_data.hostname,
        ip=firewall_data.ip,
        api_key=firewall_data.api_key,
        api_secret=encrypted_secret,
        verify_ssl=firewall_data.verify_ssl,
        ssl_cert_path=firewall_data.ssl_cert_path,
        license_expiry=firewall_data.license_expiry,
        license_type=firewall_data.license_type,
        notify_email=firewall_data.notify_email,
        notify_emails_general=firewall_data.notify_emails_general,
        notify_emails_license=firewall_data.notify_emails_license,
        license_alert_days=firewall_data.license_alert_days,
        auto_update=firewall_data.auto_update,
        auto_update_window=firewall_data.auto_update_window,
        backup_interval=firewall_data.backup_interval,
        backup_retention=firewall_data.backup_retention,
        tags=firewall_data.tags,
        notes=firewall_data.notes
    )

    db.add(firewall)
    db.commit()
    db.refresh(firewall)

    logger.info(f"Firewall created: {firewall.hostname} ({firewall.ip})")
    return firewall


@router.get("/{firewall_id}", response_model=FirewallDetailedResponse)
async def get_firewall(firewall_id: str, db: Session = Depends(get_db)):
    """Get firewall details with status"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    # Get latest status
    status = db.query(FirewallStatus).filter(
        FirewallStatus.firewall_id == firewall_id
    ).order_by(FirewallStatus.checked_at.desc()).first()

    # Get recent backups
    from app.models import Backup
    backups = db.query(Backup).filter(
        Backup.firewall_id == firewall_id
    ).order_by(Backup.created_at.desc()).limit(5).all()

    # Get recent alerts
    alerts = db.query(Alert).filter(
        Alert.firewall_id == firewall_id,
        Alert.resolved == False
    ).order_by(Alert.created_at.desc()).limit(5).all()

    # Build the response using pydantic so binary fields and SA state are excluded
    base = FirewallResponse.model_validate(firewall).model_dump()
    base["status"] = FirewallStatusResponse.model_validate(status).model_dump() if status else None
    base["recent_backups"] = [BackupResponse.model_validate(b).model_dump() for b in backups]
    base["recent_alerts"] = [AlertResponse.model_validate(a).model_dump() for a in alerts]
    return base


@router.patch("/{firewall_id}", response_model=FirewallResponse)
async def update_firewall(
    firewall_id: str,
    firewall_data: FirewallUpdate,
    db: Session = Depends(get_db)
):
    """Update firewall configuration"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    update_data = firewall_data.dict(exclude_unset=True)

    # Handle API secret encryption if provided
    if "api_secret" in update_data:
        # Note: current implementation doesn't support updating api_secret through normal updates
        # This would need a separate secure endpoint
        pass

    for field, value in update_data.items():
        setattr(firewall, field, value)

    db.commit()
    db.refresh(firewall)

    logger.info(f"Firewall updated: {firewall.hostname}")
    return firewall


@router.delete("/{firewall_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_firewall(firewall_id: str, db: Session = Depends(get_db)):
    """Remove a firewall from management"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    # Clean up related records
    db.query(FirewallStatus).filter(FirewallStatus.firewall_id == firewall_id).delete()
    db.query(Alert).filter(Alert.firewall_id == firewall_id).delete()

    db.delete(firewall)
    db.commit()

    logger.info(f"Firewall deleted: {firewall.hostname}")


@router.get("/{firewall_id}/status")
async def get_firewall_status(
    firewall_id: str,
    db: Session = Depends(get_db)
):
    """Get latest firewall health status"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    status = db.query(FirewallStatus).filter(
        FirewallStatus.firewall_id == firewall_id
    ).order_by(FirewallStatus.checked_at.desc()).first()

    if not status:
        return None

    return FirewallStatusResponse.model_validate(status).model_dump()


@router.post("/{firewall_id}/check-health")
async def check_firewall_health(
    firewall_id: str,
    db: Session = Depends(get_db)
):
    """Manually trigger a health check"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    try:
        # This would run in background in production
        status = await MonitoringService.check_firewall_health(db, firewall)
        return {
            "message": "Health check completed",
            "online": status.online,
            "firmware_version": status.firmware_version
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard/summary", response_model=DashboardSummary)
async def get_dashboard_summary(db: Session = Depends(get_db)):
    """Get dashboard summary statistics"""

    summary = MonitoringService.get_dashboard_summary(db)
    return summary


@router.get("/dashboard/firewalls-quick", response_model=List[FirewallQuickStatus])
async def get_dashboard_firewalls(db: Session = Depends(get_db)):
    """Get quick firewall status for dashboard"""

    firewalls = MonitoringService.get_firewall_quick_status(db)
    return firewalls


@router.get("/dashboard/firewalls-live", response_model=List[FirewallQuickStatus])
async def get_dashboard_firewalls_live(db: Session = Depends(get_db)):
    """Get firewall status with fresh CPU/RAM polled live from each firewall in parallel.

    Results are cached for ~10s and concurrent requests share the same in-flight call,
    so multiple browser tabs do not multiply load on the firewalls.
    """
    import asyncio
    from app.services.monitoring_service import _parse_memory, _parse_cpu_from_activity
    from app.services.live_cache import DASHBOARD_CACHE, LIVE_CACHE, bounded

    base = MonitoringService.get_firewall_quick_status(db)
    firewalls = db.query(Firewall).all()

    async def poll_one(fw: Firewall):
        async def _fetch():
            try:
                api_secret = EncryptionService.decrypt(fw.api_secret)
                api = OPNsenseAPI(fw.ip, fw.api_key, api_secret, fw.verify_ssl, fw.ssl_cert_path)
                # Override timeout to keep dashboard snappy even when one firewall is slow
                api.timeout = 5
                resources, activity = await asyncio.gather(
                    api.get_system_resources(),
                    api.get_activity(),
                    return_exceptions=True,
                )
                return {
                    "online": True,
                    "cpu": _parse_cpu_from_activity(activity) if not isinstance(activity, Exception) else None,
                    "ram": _parse_memory(resources) if not isinstance(resources, Exception) else None,
                }
            except Exception:
                return {"online": False, "cpu": None, "ram": None}

        return str(fw.id), await LIVE_CACHE.get_or_fetch(str(fw.id), lambda: bounded(_fetch))

    async def _collect():
        results = await asyncio.gather(*[poll_one(fw) for fw in firewalls])
        return dict(results)

    live = await DASHBOARD_CACHE.get_or_fetch("_dashboard", _collect)

    for item in base:
        data = live.get(str(item["id"]))
        if not data:
            continue
        if data["cpu"] is not None:
            item["cpu_usage"] = data["cpu"]
        if data["ram"] is not None:
            item["ram_usage"] = data["ram"]
        if data["online"] is not None:
            item["online"] = data["online"]
    return base


@router.post("/{firewall_id}/fetch-license")
async def fetch_license_from_firewall(
    firewall_id: str,
    db: Session = Depends(get_db)
):
    """
    Pull license info directly from OPNsense firmware API.
    Detects community vs. business edition and saves it.
    """
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path
        )
        fw_status = await api.get_firmware_status()

        product_name = fw_status.get("product_name", "")
        if "business" in product_name.lower():
            license_type = "business"
        else:
            license_type = "community"

        firewall.license_type = license_type
        db.commit()

        return {
            "license_type": license_type,
            "product_name": product_name,
            "product_version": fw_status.get("product_version"),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach firewall: {e}")


@router.get("/{firewall_id}/logs")
async def get_firewall_logs(
    firewall_id: str,
    log_type: str = "firewall",
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Fetch live logs from OPNsense (log_type: firewall|system|backend)"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path
        )
        if log_type == "system":
            data = await api.get_system_logs(limit=limit)
        elif log_type == "backend":
            data = await api.get_backend_logs(limit=limit)
        else:
            data = await api.get_firewall_logs(limit=limit)
        return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach firewall: {e}")


@router.get("/{firewall_id}/smart")
async def get_firewall_smart(
    firewall_id: str,
    db: Session = Depends(get_db),
):
    """Fetch SMART disk health (requires os-smart plugin on the firewall)"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path,
        )
        listing = await api.smart_list()
        devices = []
        if isinstance(listing, dict):
            raw_devs = listing.get("rows") or listing.get("devices") or []
            if isinstance(raw_devs, list):
                for d in raw_devs:
                    dev_name = d.get("dev") or d.get("device") or d.get("name")
                    if not dev_name:
                        continue
                    info = {}
                    try:
                        info = await api.smart_info(dev_name, d.get("type") or "auto")
                    except Exception as ie:
                        logger.debug(f"smart_info failed for {dev_name}: {ie}")
                    devices.append({
                        "device": dev_name,
                        "type": d.get("type"),
                        "model": d.get("model") or info.get("model"),
                        "serial": d.get("serial") or info.get("serial"),
                        "status": d.get("status") or info.get("status"),
                        "info": info,
                    })
        return {"available": True, "devices": devices}
    except Exception as e:
        # Degrade gracefully but expose real reason to UI.
        msg = str(e)
        lowered = msg.lower()
        plugin_missing = (
            "not found" in lowered
            or "404" in lowered
            or "plugin" in lowered
            or "smart/service" in lowered and "no route" in lowered
        )
        if plugin_missing:
            reason = "os-smart plugin not installed or API path unavailable"
        else:
            reason = f"SMART query failed: {msg}"
        logger.warning(f"SMART unavailable for {firewall.hostname}: {reason}")
        return {"available": False, "reason": reason, "devices": []}


@router.get("/{firewall_id}/live-stats")
async def get_live_stats(
    firewall_id: str,
    db: Session = Depends(get_db),
):
    """Lightweight live CPU/RAM/uptime poll (no DB writes, cached ~4s)."""
    from app.services.monitoring_service import (
        _parse_memory,
        _parse_cpu_from_activity,
        _parse_uptime,
    )
    from app.services.live_cache import LIVE_CACHE, bounded

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    async def _fetch():
        try:
            api_secret = EncryptionService.decrypt(firewall.api_secret)
            api = OPNsenseAPI(
                firewall.ip, firewall.api_key, api_secret,
                firewall.verify_ssl, firewall.ssl_cert_path,
            )
            api.timeout = 5
            import asyncio
            resources, activity, tm = await asyncio.gather(
                api.get_system_resources(),
                api.get_activity(),
                api.get_system_time(),
                return_exceptions=True,
            )
            return {
                "online": True,
                "cpu_usage": _parse_cpu_from_activity(activity) if not isinstance(activity, Exception) else None,
                "ram_usage": _parse_memory(resources) if not isinstance(resources, Exception) else None,
                "uptime_seconds": _parse_uptime(tm) if not isinstance(tm, Exception) else None,
            }
        except Exception as e:
            return {"online": False, "error": str(e), "cpu_usage": None, "ram_usage": None, "uptime_seconds": None}

    return await LIVE_CACHE.get_or_fetch(f"detail:{firewall_id}", lambda: bounded(_fetch))


@router.get("/{firewall_id}/services")
async def get_firewall_services(
    firewall_id: str,
    db: Session = Depends(get_db),
):
    """Fetch live service status directly from OPNsense.

    This is used by the detail view to show the same service list the OPNsense
    UI exposes (for example Unbound, Paketfilter, WireGuard instances, Cron).
    """
    from app.services.monitoring_service import _parse_services

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path,
        )
        api.timeout = 8
        raw = await api.get_services_status()
        rows = raw.get("rows", []) if isinstance(raw, dict) else []
        return {
            "services": _parse_services(rows),
            "pending_services": [
                svc["name"] for svc in _parse_services(rows)
                if svc.get("enabled") is True and svc.get("running") is False
            ],
            "raw_count": len(rows),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch services: {e}")


@router.post("/{firewall_id}/services/restart")
async def restart_firewall_service(
    firewall_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    """Restart a single OPNsense service by id/name from the live service list."""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    identifier = payload.get("service_id") or payload.get("name")
    if not identifier:
        raise HTTPException(status_code=400, detail="service_id or name is required")

    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path,
        )
        api.timeout = 15
        result = await api.restart_service(str(identifier))
        return {"message": f"Restart requested for {identifier}", "result": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not restart service {identifier}: {e}")


@router.post("/{firewall_id}/services/start")
async def start_firewall_service(
    firewall_id: str,
    payload: dict,
    db: Session = Depends(get_db),
):
    """Start a single OPNsense service by id/name from the live service list."""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    identifier = payload.get("service_id") or payload.get("name")
    if not identifier:
        raise HTTPException(status_code=400, detail="service_id or name is required")

    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path,
        )
        api.timeout = 15
        result = await api.start_service(str(identifier))
        return {"message": f"Start requested for {identifier}", "result": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not start service {identifier}: {e}")


@router.post("/{firewall_id}/reboot")
async def reboot_firewall(
    firewall_id: str,
    db: Session = Depends(get_db),
):
    """Reboot the OPNsense firewall."""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path,
        )
        result = await api.reboot_system()
        logger.info(f"Reboot initiated on {firewall.hostname}: {result}")
        return {"message": "Reboot initiated", "result": result}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Reboot failed: {e}")


@router.post("/{firewall_id}/update-api-secret")
async def update_api_secret(
    firewall_id: str,
    payload: dict,
    db: Session = Depends(get_db)
):
    """Update the API secret for a firewall (encrypted at rest)"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    new_secret = payload.get("api_secret")
    if not new_secret:
        raise HTTPException(status_code=400, detail="api_secret is required")

    firewall.api_secret = EncryptionService.encrypt(new_secret)
    db.commit()
    return {"message": "API secret updated"}
