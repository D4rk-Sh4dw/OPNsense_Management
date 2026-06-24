import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models import Firewall, Alert, UpdateHistory
from app.schemas import UpdateHistoryResponse
from app.services.update_service import UpdateService

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
        result = await UpdateService.refresh_firewall_update_status(db, firewall, trigger_check=True)
        return result
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


@router.get("/history")
async def get_all_update_history(
    db: Session = Depends(get_db),
    limit: int = 100,
    status: str | None = None,
):
    """Get update history across all firewalls (for the Dashboard logs tab)."""

    q = db.query(UpdateHistory, Firewall).join(
        Firewall, Firewall.id == UpdateHistory.firewall_id
    )
    if status:
        q = q.filter(UpdateHistory.status == status)
    rows = q.order_by(UpdateHistory.started_at.desc()).limit(limit).all()

    return [
        {
            "id": str(uh.id),
            "firewall_id": str(uh.firewall_id),
            "firewall_name": fw.customer_name,
            "hostname": fw.hostname,
            "ip": fw.ip,
            "version_before": uh.version_before,
            "version_after": uh.version_after,
            "triggered_by": uh.triggered_by,
            "status": uh.status,
            "log": uh.log,
            "started_at": uh.started_at.isoformat() if uh.started_at else None,
            "completed_at": uh.completed_at.isoformat() if uh.completed_at else None,
        }
        for uh, fw in rows
    ]


@router.get("/pending")
async def get_pending_updates(db: Session = Depends(get_db)):
    """Get all firewalls with pending updates"""

    # This would check all firewalls
    result = await UpdateService.check_pending_updates(db)
    return result
