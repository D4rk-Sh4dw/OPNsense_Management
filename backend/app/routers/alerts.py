import logging
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall, Alert
from app.schemas import AlertResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=List[AlertResponse])
async def list_alerts(
    db: Session = Depends(get_db),
    severity: str = None,
    resolved: bool | None = False,
    limit: int = 100,
    offset: int = 0
):
    """Get alerts with filtering options. Pass resolved=null to fetch all."""

    query = db.query(Alert)
    if resolved is not None:
        query = query.filter(Alert.resolved == resolved)

    if severity:
        query = query.filter(Alert.severity == severity)

    alerts = query.order_by(Alert.created_at.desc()).limit(limit).offset(offset).all()
    return alerts


@router.get("/{alert_id}", response_model=AlertResponse)
async def get_alert(alert_id: str, db: Session = Depends(get_db)):
    """Get specific alert"""

    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    return alert


@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: str, db: Session = Depends(get_db)):
    """Mark alert as resolved"""

    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.resolved = True
    alert.resolved_at = datetime.utcnow()
    db.commit()

    return {"message": "Alert resolved", "alert_id": alert_id}


@router.delete("/{alert_id}")
async def delete_alert(alert_id: str, db: Session = Depends(get_db)):
    """Delete alert"""

    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    db.delete(alert)
    db.commit()

    return {"message": "Alert deleted"}
