"""
Router for firewall config history endpoints:
- List revisions from DB
- Sync revisions from OPNsense
- Compare two revisions
- Revert to a revision
"""
import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall, ConfigHistory
from app.schemas import (
    ConfigHistoryResponse,
    ConfigHistoryDiffRequest,
    ConfigHistoryRevertRequest,
)
from app.services.config_history_service import ConfigHistoryService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/config-history", tags=["config-history"])


@router.get("/firewalls/{firewall_id}", response_model=List[ConfigHistoryResponse])
async def list_revisions(firewall_id: str, db: Session = Depends(get_db)):
    """List all known config revisions for a firewall (from DB), sorted by date descending."""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    
    rows = (
        db.query(ConfigHistory)
        .filter(ConfigHistory.firewall_id == firewall_id)
        .order_by(ConfigHistory.revision_date.desc())
        .all()
    )
    return rows


@router.post("/firewalls/{firewall_id}/sync")
async def sync_revisions(firewall_id: str, db: Session = Depends(get_db)):
    """Pull latest config revisions from the firewall and store new ones."""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    
    logger.info(f"Manual config history sync triggered for {firewall.hostname} ({firewall.ip})")
    try:
        added = await ConfigHistoryService.sync_revisions(db, firewall)
        logger.info(f"Sync completed for {firewall.hostname}: +{added} revisions")
        return {"firewall_id": str(firewall_id), "added": added, "status": "success"}
    except Exception as e:
        logger.exception(f"Config history sync failed for {firewall.hostname}: {e}")
        raise HTTPException(status_code=502, detail=f"Sync failed: {str(e)}")


@router.post("/firewalls/{firewall_id}/diff")
async def diff_revisions(
    firewall_id: str,
    payload: ConfigHistoryDiffRequest,
    db: Session = Depends(get_db),
):
    """Return a unified diff between two revisions."""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    
    try:
        return await ConfigHistoryService.diff_revisions(
            db, firewall, payload.revision_a, payload.revision_b
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Diff failed: {str(e)}")


@router.post("/firewalls/{firewall_id}/revert")
async def revert_to_revision(
    firewall_id: str,
    payload: ConfigHistoryRevertRequest,
    db: Session = Depends(get_db),
):
    """Roll back the firewall to a specific revision (creates a backup first as safety net)."""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    
    try:
        return await ConfigHistoryService.revert_to_revision(
            db, firewall, payload.revision_id, payload.create_backup
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Revert failed: {str(e)}")
