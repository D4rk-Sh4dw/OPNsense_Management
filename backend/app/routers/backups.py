import logging
import os
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models import Firewall, Backup
from app.schemas import BackupResponse, BackupCreate
from app.services.backup_service import BackupService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/backups", tags=["backups"])


class RestoreBody(BaseModel):
    backup_id: str
    areas: Optional[List[str]] = None  # if empty/None → full restore


def _create_backup_bg(firewall_id: str, triggered_by: str):
    """Background task wrapper using its own DB session"""
    db = SessionLocal()
    try:
        firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
        if firewall:
            import asyncio
            asyncio.run(BackupService.create_backup(db, firewall, triggered_by))
    except Exception as e:
        logger.error(f"Background backup failed: {e}")
    finally:
        db.close()


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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    backup_data: BackupCreate | None = None,
):
    """Create a new backup of firewall configuration"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    triggered_by = backup_data.triggered_by if backup_data else "manual"

    # Run backup in background with its own DB session
    background_tasks.add_task(_create_backup_bg, firewall_id, triggered_by)

    return {
        "firewall_id": firewall_id,
        "message": "Backup creation initiated"
    }


@router.post("/firewalls/{firewall_id}/restore")
async def restore_backup(
    firewall_id: str,
    body: RestoreBody,
    db: Session = Depends(get_db)
):
    """Restore a backup to a firewall"""

    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    backup = db.query(Backup).filter(Backup.id == body.backup_id).first()
    if not backup or str(backup.firewall_id) != str(firewall_id):
        raise HTTPException(status_code=404, detail="Backup not found")

    try:
        result = await BackupService.restore_backup(firewall, backup.filepath, body.areas)
        return {
            "message": "Backup restore initiated",
            "areas": body.areas or "all",
            "result": result
        }
    except Exception as e:
        logger.error(f"Restore failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/firewalls/{firewall_id}/backups/{backup_id}/download")
async def download_backup(
    firewall_id: str,
    backup_id: str,
    db: Session = Depends(get_db),
):
    """Download a stored backup XML file"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")

    backup = db.query(Backup).filter(Backup.id == backup_id).first()
    if not backup or str(backup.firewall_id) != str(firewall_id):
        raise HTTPException(status_code=404, detail="Backup not found")

    if not backup.filepath or not os.path.exists(backup.filepath):
        raise HTTPException(status_code=404, detail="Backup file is missing on disk")

    return FileResponse(
        backup.filepath,
        media_type="application/xml",
        filename=backup.filename or os.path.basename(backup.filepath),
    )


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
    if not backup or str(backup.firewall_id) != str(firewall_id):
        raise HTTPException(status_code=404, detail="Backup not found")

    import os
    if backup.filepath and os.path.exists(backup.filepath):
        os.remove(backup.filepath)
        logger.info(f"Deleted backup file: {backup.filepath}")

    db.delete(backup)
    db.commit()

    return {"message": "Backup deleted"}
