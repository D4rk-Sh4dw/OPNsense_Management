import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import SchedulerSettings
from app.schemas import SchedulerSettingsResponse, SchedulerSettingsUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create_scheduler_settings(db: Session) -> SchedulerSettings:
    row = db.query(SchedulerSettings).filter(SchedulerSettings.id == 1).first()
    if row:
        return row
    row = SchedulerSettings(id=1)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/scheduler", response_model=SchedulerSettingsResponse)
async def get_scheduler_settings(db: Session = Depends(get_db)):
    return _get_or_create_scheduler_settings(db)


@router.patch("/scheduler", response_model=SchedulerSettingsResponse)
async def update_scheduler_settings(payload: SchedulerSettingsUpdate, db: Session = Depends(get_db)):
    row = _get_or_create_scheduler_settings(db)

    update_data = payload.model_dump(exclude_unset=True)
    if "monitoring_interval_seconds" in update_data:
        row.monitoring_interval_seconds = max(5, int(update_data["monitoring_interval_seconds"]))
    if "monitoring_interval_minutes" in update_data:
        row.monitoring_interval_minutes = max(1, int(update_data["monitoring_interval_minutes"]))
    if "license_check_hour" in update_data:
        row.license_check_hour = max(0, min(23, int(update_data["license_check_hour"])))
    if "smart_check_hour" in update_data:
        row.smart_check_hour = max(0, min(23, int(update_data["smart_check_hour"])))

    db.commit()
    db.refresh(row)
    logger.info("Scheduler settings updated via API")
    return row
