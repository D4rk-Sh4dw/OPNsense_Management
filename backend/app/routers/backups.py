import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall, Backup
from app.schemas import BackupResponse, BackupCreate
from app.services.backup_service import BackupService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/backups", tags=["backups"])


@router.get("/firewalls/{firewall_id}", response_model=List[BackupResponse])
async def list_backups(
    firewall_id: str,
    db: Session = Depends(get_db),
    limit: int = 50
):
    """List backups for a firewall"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    backups = await BackupService.list_backups(db, firewall_id)
    return backups[:limit]


@router.post("/firewalls/{firewall_id}/create")
async def create_backup(
    firewall_id: str,
    backup_data: BackupCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Create a new backup of firewall configuration"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    # Run backup in background
    background_tasks.add_task(
        BackupService.create_backup,
        db,
        firewall,
        backup_data.triggered_by
    )

    return {
        "firewall_id": firewall_id,
        "message": "Backup creation initiated"
    }


@router.post("/firewalls/{firewall_id}/restore")
async def restore_backup(
    firewall_id: str,
    backup_id: str,
    db: Session = Depends(get_db)
):
    """Restore a backup to a firewall"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    backup = db.query(Backup).filter(Backup.id == backup_id).first()
    if not backup or backup.firewall_id != firewall_id:
        raise HTTPException(status_code=404, detail="Backup not found")

    try:
        result = await BackupService.restore_backup(firewall, backup.filepath)
        return {
            "message": "Backup restore initiated",
            "result": result
        }
    except Exception as e:
        logger.error(f"Restore failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/firewalls/{firewall_id}/backups/{backup_id}")
async def delete_backup(
    firewall_id: str,
    backup_id: str,
    db: Session = Depends(get_db)
):
    """Delete a local backup"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    backup = db.query(Backup).filter(Backup.id == backup_id).first()
    if not backup or backup.firewall_id != firewall_id:
        raise HTTPException(status_code=404, detail="Backup not found")

    import os
    if backup.filepath and os.path.exists(backup.filepath):
        os.remove(backup.filepath)
        logger.info(f"Deleted backup file: {backup.filepath}")

    db.delete(backup)
    db.commit()

    return {"message": "Backup deleted"}
