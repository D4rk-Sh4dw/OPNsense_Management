import logging
from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall, FirewallStatus, Alert
from app.schemas import FirewallCreate, FirewallUpdate, FirewallResponse, FirewallDetailedResponse, DashboardSummary, FirewallQuickStatus
from app.services.encryption_service import EncryptionService
from app.services.monitoring_service import MonitoringService

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

    result = {
        **firewall.__dict__,
        "status": status,
        "recent_backups": backups,
        "recent_alerts": alerts
    }

    return result


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


@router.get("/{firewall_id}/status", response_model=dict)
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
        return {"message": "No status data yet"}

    return status.__dict__


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
