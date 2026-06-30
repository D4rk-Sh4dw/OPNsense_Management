import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Firewall
from app.services.opnsense_api import OPNsenseAPI
from app.services.encryption_service import EncryptionService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/firewalls", tags=["vpn"])


def _make_api(firewall: Firewall) -> OPNsenseAPI:
    secret = EncryptionService.decrypt(firewall.api_secret)
    return OPNsenseAPI(
        host=firewall.ip,
        api_key=firewall.api_key,
        api_secret=secret,
        verify_ssl=firewall.verify_ssl,
        ssl_cert_path=firewall.ssl_cert_path,
    )


@router.get("/{firewall_id}/vpn/openvpn")
async def get_openvpn_sessions(firewall_id: str, db: Session = Depends(get_db)):
    """Fetch active OpenVPN sessions from OPNsense"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    try:
        api = _make_api(firewall)
        data = await api.get_openvpn_sessions()
        return data
    except Exception as e:
        logger.warning(f"OpenVPN sessions unavailable for {firewall_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/{firewall_id}/vpn/wireguard")
async def get_wireguard_status(firewall_id: str, db: Session = Depends(get_db)):
    """Fetch WireGuard peer status from OPNsense"""
    firewall = db.query(Firewall).filter(Firewall.id == firewall_id).first()
    if not firewall:
        raise HTTPException(status_code=404, detail="Firewall not found")
    try:
        api = _make_api(firewall)
        data = await api.get_wireguard_status()
        return data
    except Exception as e:
        logger.warning(f"WireGuard status unavailable for {firewall_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
