import base64
import logging
from typing import Optional, Dict, Any
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class OPNsenseAPI:
    """Client for interacting with OPNsense REST API"""

    def __init__(
        self,
        host: str,
        api_key: str,
        api_secret: str,
        verify_ssl: bool = False,
        ssl_cert_path: Optional[str] = None
    ):
        """
        Initialize OPNsense API client

        Args:
            host: Firewall IP/hostname (e.g., "192.168.1.1")
            api_key: API key
            api_secret: API secret
            verify_ssl: Whether to verify SSL certificate
            ssl_cert_path: Path to CA certificate file
        """
        self.host = host
        self.api_key = api_key
        self.api_secret = api_secret
        self.verify_ssl = verify_ssl or ssl_cert_path
        self.ssl_cert_path = ssl_cert_path
        self.base_url = f"https://{host}/api"
        self.timeout = settings.REQUEST_TIMEOUT_SECONDS

        # Setup SSL verification
        if self.verify_ssl and ssl_cert_path:
            self.verify = ssl_cert_path
        else:
            self.verify = False

    def _get_auth_header(self) -> Dict[str, str]:
        """Generate HTTP Basic Auth header"""
        credentials = f"{self.api_key}:{self.api_secret}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return {"Authorization": f"Basic {encoded}"}

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Make HTTP request to OPNsense API

        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (e.g., "/core/firmware/status")
            **kwargs: Additional arguments for httpx

        Returns:
            Response JSON dict
        """
        url = f"{self.base_url}{endpoint}"
        headers = self._get_auth_header()

        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as client:
            try:
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    **kwargs
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                logger.error(f"OPNsense API error on {self.host}: {e}")
                raise

    # ===== Firmware endpoints =====
    async def get_firmware_status(self) -> Dict[str, Any]:
        """GET /api/core/firmware/status"""
        return await self._request("GET", "/core/firmware/status")

    async def check_firmware_updates(self) -> Dict[str, Any]:
        """POST /api/core/firmware/check"""
        return await self._request("POST", "/core/firmware/check")

    async def install_updates(self) -> Dict[str, Any]:
        """POST /api/core/firmware/update"""
        return await self._request("POST", "/core/firmware/update")

    async def get_upgrade_status(self) -> Dict[str, Any]:
        """GET /api/core/firmware/upgradestatus"""
        return await self._request("GET", "/core/firmware/upgradestatus")

    async def reboot_system(self) -> Dict[str, Any]:
        """POST /api/core/firmware/reboot"""
        return await self._request("POST", "/core/firmware/reboot")

    # ===== Backup endpoints =====
    async def list_backups(self) -> Dict[str, Any]:
        """GET /api/core/backup/list"""
        return await self._request("GET", "/core/backup/list")

    async def create_backup(self) -> Dict[str, Any]:
        """POST /api/core/backup/backup"""
        return await self._request("POST", "/core/backup/backup")

    async def download_backup(self, filename: str) -> bytes:
        """GET /api/core/backup/download/{filename}"""
        url = f"{self.base_url}/core/backup/download/{filename}"
        headers = self._get_auth_header()

        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.content

    async def delete_backup(self, filename: str) -> Dict[str, Any]:
        """POST /api/core/backup/delete/{filename}"""
        return await self._request("POST", f"/core/backup/delete/{filename}")

    async def restore_backup(self, crypto: str, payload: str) -> Dict[str, Any]:
        """POST /api/core/backup/restore"""
        data = {"crypto": crypto, "payload": payload}
        return await self._request("POST", "/core/backup/restore", json=data)

    # ===== Diagnostics endpoints =====
    async def get_system_health(self) -> Dict[str, Any]:
        """GET /api/diagnostics/systemhealth/get"""
        return await self._request("GET", "/diagnostics/systemhealth/get")

    async def get_gateway_status(self) -> Dict[str, Any]:
        """GET /api/routes/gateway/status"""
        return await self._request("GET", "/routes/gateway/status")

    async def get_services_status(self) -> Dict[str, Any]:
        """POST /api/core/service/search"""
        return await self._request("POST", "/core/service/search")

    async def get_arp_table(self) -> Dict[str, Any]:
        """GET /api/diagnostics/interface/getArp"""
        return await self._request("GET", "/diagnostics/interface/getArp")

    # ===== Logs endpoints =====
    async def get_firewall_logs(self, limit: int = 100, offset: int = 0) -> Dict[str, Any]:
        """GET /api/diagnostics/log/core/firewall"""
        return await self._request(
            "GET",
            "/diagnostics/log/core/firewall",
            params={"limit": limit, "offset": offset}
        )

    async def get_system_logs(self, limit: int = 100, offset: int = 0) -> Dict[str, Any]:
        """GET /api/diagnostics/log/core/system"""
        return await self._request(
            "GET",
            "/diagnostics/log/core/system",
            params={"limit": limit, "offset": offset}
        )

    async def get_backend_logs(self, limit: int = 100, offset: int = 0) -> Dict[str, Any]:
        """GET /api/diagnostics/log/core/backend"""
        return await self._request(
            "GET",
            "/diagnostics/log/core/backend",
            params={"limit": limit, "offset": offset}
        )

    # ===== S.M.A.R.T. endpoints =====
    async def get_smart_devices(self) -> Dict[str, Any]:
        """GET /api/diagnostics/smart/getDevices"""
        return await self._request("GET", "/diagnostics/smart/getDevices")

    async def get_smart_device_info(self, device: str) -> Dict[str, Any]:
        """GET /api/diagnostics/smart/getDeviceInfo/{device}"""
        return await self._request("GET", f"/diagnostics/smart/getDeviceInfo/{device}")

    # ===== System Info =====
    async def get_system_info(self) -> Dict[str, Any]:
        """GET /api/core/system/info"""
        return await self._request("GET", "/core/system/info")
