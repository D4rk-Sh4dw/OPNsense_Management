import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models import Firewall, Alert, UpdateHistory
from app.schemas import UpdateHistoryResponse
from app.services.update_service import UpdateService
from app.services.opnsense_api import (
    OPNsenseAPI,
    extract_firmware_version,
    extract_latest_firmware_version,
    extract_firmware_update_count,
    extract_needs_reboot,
)
from app.services.encryption_service import EncryptionService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/updates", tags=["updates"])


def _install_updates_bg(firewall_id: str, triggered_by: str):
    """Background task wrapper using its own DB session"""
    db = SessionLocal()
    try:
        firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
        if firewall:
            import asyncio
            asyncio.run(UpdateService.install_updates(db, firewall, triggered_by))
    except Exception as e:
        logger.error(f"Background update failed: {e}")
    finally:
        db.close()


@router.post("/firewalls/{firewall_id}/check")
async def check_updates(
    firewall_id: str,
    db: Session = Depends(get_db)
):
    """Check for available updates on a firewall (calls OPNsense API)"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    try:
        api_secret = EncryptionService.decrypt(firewall.api_secret)
        api = OPNsenseAPI(
            firewall.ip, firewall.api_key, api_secret,
            firewall.verify_ssl, firewall.ssl_cert_path
        )
        # Trigger fresh check then fetch status
        try:
            await api.check_firmware_updates()
        except Exception:
            pass  # check endpoint may not always return JSON
        status = await api.get_firmware_status()
        return {
            "firewall_id": firewall_id,
            "updates_available": extract_firmware_update_count(status),
            "current_version": extract_firmware_version(status),
            "latest_version": extract_latest_firmware_version(status),
            "download_size": status.get("download_size"),
            "needs_reboot": extract_needs_reboot(status),
            "status_msg": status.get("status_msg"),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach firewall: {e}")


@router.post("/firewalls/{firewall_id}/install")
async def install_updates(
    firewall_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Install firmware updates on a firewall"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    # Add update task to background with its own DB session
    background_tasks.add_task(_install_updates_bg, firewall_id, "manual")

    return {
        "firewall_id": firewall_id,
        "message": "Update installation started"
    }


@router.get("/firewalls/{firewall_id}/history", response_model=List[UpdateHistoryResponse])
async def get_update_history(
    firewall_id: str,
    db: Session = Depends(get_db),
    limit: int = 20
):
    """Get update history for a firewall"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    updates = db.query(UpdateHistory).filter(
        UpdateHistory.firewall_id == firewall_id
    ).order_by(UpdateHistory.started_at.desc()).limit(limit).all()

    return updates


@router.get("/pending")
async def get_pending_updates(db: Session = Depends(get_db)):
    """Get all firewalls with pending updates"""

    # This would check all firewalls
    result = await UpdateService.check_pending_updates(db)
    return result
