"""API endpoints for editable e-mail templates and branding."""

from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import EmailBrandingSettings, EmailTemplate
from app.schemas import (
    EmailBrandingResponse,
    EmailBrandingUpdate,
    EmailPreviewRequest,
    EmailPreviewResponse,
    EmailTemplateResponse,
    EmailTemplateUpdate,
)
from app.services.email_service import EmailService, parse_recipients

router = APIRouter(prefix="/api/email", tags=["email"])


# -- Templates -----------------------------------------------------------

@router.get("/templates", response_model=List[EmailTemplateResponse])
async def list_templates(db: Session = Depends(get_db)):
    return db.query(EmailTemplate).order_by(EmailTemplate.category, EmailTemplate.key).all()


@router.get("/templates/{key}", response_model=EmailTemplateResponse)
async def get_template(key: str, db: Session = Depends(get_db)):
    tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


@router.patch("/templates/{key}", response_model=EmailTemplateResponse)
async def update_template(key: str, payload: EmailTemplateUpdate, db: Session = Depends(get_db)):
    tpl = db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(tpl, field, value)
    tpl.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tpl)
    return tpl


# -- Branding ------------------------------------------------------------

def _get_or_create_branding(db: Session) -> EmailBrandingSettings:
    row = db.query(EmailBrandingSettings).first()
    if not row:
        row = EmailBrandingSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/branding", response_model=EmailBrandingResponse)
async def get_branding(db: Session = Depends(get_db)):
    return _get_or_create_branding(db)


@router.patch("/branding", response_model=EmailBrandingResponse)
async def update_branding(payload: EmailBrandingUpdate, db: Session = Depends(get_db)):
    row = _get_or_create_branding(db)
    for field, value in payload.dict(exclude_unset=True).items():
        setattr(row, field, value)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


# -- Preview & Test ------------------------------------------------------

_DEFAULT_PREVIEW = {
    "customer_name": "ACME GmbH",
    "hostname": "fw01.acme.local",
    "expiry_date": "2026-08-15",
    "days_remaining": 7,
    "error_message": "Update repository unreachable",
    "device": "ada0",
    "status": "FAILED",
    "title": "Preview Alert",
    "severity": "WARNING",
    "details": "Dies ist eine Vorschau des Templates mit Beispieldaten.",
}


@router.post("/preview", response_model=EmailPreviewResponse)
async def preview_template(payload: EmailPreviewRequest, db: Session = Depends(get_db)):
    sample = {**_DEFAULT_PREVIEW, **(payload.sample_data or {})}
    rendered = EmailService.render(payload.template_key, sample)
    return EmailPreviewResponse(**rendered, recipients=None)


@router.post("/templates/{key}/test")
async def send_test(key: str, recipients: dict, db: Session = Depends(get_db)):
    """Send a test message to the given recipient list using the template."""
    to = recipients.get("recipients") if isinstance(recipients, dict) else None
    addrs = parse_recipients(to)
    if not addrs:
        raise HTTPException(status_code=400, detail="No valid recipients provided")
    ok = EmailService.send(key, addrs, _DEFAULT_PREVIEW)
    return {"sent": ok, "recipients": addrs}
