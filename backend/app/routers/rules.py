import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/firewalls", tags=["rules"])


def _make_api(firewall: Firewall) -> OPNsenseAPI:
    secret = EncryptionService.decrypt(firewall.api_secret)
    return OPNsenseAPI(
        host=firewall.ip,
        api_key=firewall.api_key,
        api_secret=secret,
        verify_ssl=firewall.verify_ssl,
        ssl_cert_path=firewall.ssl_cert_path,
    )


@router.get("/{firewall_id}/rules")
async def get_firewall_rules(
    firewall_id: str,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """Fetch firewall filter rules from OPNsense"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    try:
        api = _make_api(firewall)
        data = await api.get_firewall_rules(limit=limit)
        return data
    except Exception as e:
        logger.error(f"Failed to fetch rules for {firewall_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{firewall_id}/aliases")
async def get_firewall_aliases(
    firewall_id: str,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """Fetch firewall aliases from OPNsense"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    try:
        api = _make_api(firewall)
        data = await api.get_firewall_aliases(limit=limit)
        return data
    except Exception as e:
        logger.error(f"Failed to fetch aliases for {firewall_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
