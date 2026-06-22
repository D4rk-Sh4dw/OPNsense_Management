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
