import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall, Alert, UpdateHistory
from app.schemas import UpdateHistoryResponse
from app.services.update_service import UpdateService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/updates", tags=["updates"])


@router.post("/firewalls/{firewall_id}/check")
async def check_updates(
    firewall_id: str,
    db: Session = Depends(get_db)
):
    """Check for available updates on a firewall"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    # This would call OPNsense API to check
    # For now, return a placeholder
    return {
        "firewall_id": firewall_id,
        "message": "Update check initiated"
    }


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

    # Add update task to background
    background_tasks.add_task(UpdateService.install_updates, db, firewall, "manual")

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
