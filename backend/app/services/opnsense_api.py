import base64
import logging
import re
from typing import Optional, Dict, Any
import httpx
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _to_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "on", "enabled", "running", "up"}:
            return True
        if v in {"0", "false", "no", "off", "disabled", "stopped", "down"}:
            return False
    return None


def _extract_version(status: Dict[str, Any], keys: list[str]) -> Optional[str]:
    for key in keys:
        value = status.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    product = status.get("product")
    if isinstance(product, dict):
        for key in keys:
            value = product.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def extract_firmware_update_count(status: Dict[str, Any]) -> int:
    """Best-effort update count parser for different OPNsense firmware payload shapes."""
    candidates = [
        status.get("updates"),
        status.get("update_count"),
        status.get("updates_count"),
        status.get("upgrade_packages"),
        status.get("packages"),
        status.get("all_packages"),
    ]

    def _parse(v: Any) -> Optional[int]:
        if v is None:
            return None
        if isinstance(v, bool):
            return 1 if v else 0
        if isinstance(v, (int, float)):
            return int(v)
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.isdigit():
                return int(stripped)
            m = re.search(r"(\d+)", stripped)
            if m:
                return int(m.group(1))
            return None
        if isinstance(v, (list, tuple, set)):
            return len(v)
        if isinstance(v, dict):
            for key in ("total", "count", "all", "updates", "upgrade_packages", "rowCount"):
                parsed = _parse(v.get(key))
                if parsed is not None:
                    return parsed
            for key in ("rows", "packages", "items"):
                if isinstance(v.get(key), list):
                    return len(v.get(key))
        return None

    for value in candidates:
        parsed = _parse(value)
        if parsed is not None:
            return max(0, parsed)

    status_msg = status.get("status_msg")
    if isinstance(status_msg, str):
        m = re.search(r"(\d+)\s+update", status_msg.lower())
        if m:
            return int(m.group(1))

    current_version = extract_firmware_version(status)
    latest_version = extract_latest_firmware_version(status)
    if current_version and latest_version and current_version != latest_version:
        return 1

    return 0


def extract_firmware_version(status: Dict[str, Any]) -> Optional[str]:
    return _extract_version(status, ["product_version", "version", "running_version", "installed_version"])


def extract_latest_firmware_version(status: Dict[str, Any]) -> Optional[str]:
    return _extract_version(status, ["product_latest", "latest_version", "upgrade_version", "new_version"])


def extract_needs_reboot(status: Dict[str, Any]) -> bool:
    for key in ("upgrade_needs_reboot", "needs_reboot", "reboot_required"):
        parsed = _to_bool(status.get(key))
        if parsed is not None:
            return parsed
    return False


def extract_license_type(status: Dict[str, Any]) -> Optional[str]:
    """Detect business/community edition from firmware status across variant payloads."""
    text_parts = []
    for key in ("product_name", "product", "edition", "license", "license_type", "product_edition"):
        value = status.get(key)
        if isinstance(value, str):
            text_parts.append(value)
        elif isinstance(value, dict):
            for sub_value in value.values():
                if isinstance(sub_value, str):
                    text_parts.append(sub_value)

    haystack = " ".join(text_parts).lower()
    if not haystack:
        return None
    if "business" in haystack or "business edition" in haystack:
        return "business"
    if "community" in haystack or "community edition" in haystack:
        return "community"
    return None


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
        self.verify_ssl = bool(verify_ssl)
        self.ssl_cert_path = ssl_cert_path
        self.base_url = f"https://{host}/api"
        self.timeout = settings.REQUEST_TIMEOUT_SECONDS

        # Setup SSL verification:
        # - cert path → use it as CA bundle
        # - verify_ssl=True without cert → trust system CAs
        # - verify_ssl=False → no verification (self-signed dev firewalls)
        if ssl_cert_path:
            self.verify = ssl_cert_path
        elif self.verify_ssl:
            self.verify = True
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
                # Some endpoints return empty body
                if not response.content:
                    return {}
                try:
                    return response.json()
                except Exception:
                    return {"raw": response.text}
            except httpx.HTTPError as e:
                logger.error(f"OPNsense API error on {self.host} {method} {endpoint}: {e}")
                raise

    async def _request_raw(self, method: str, endpoint: str, **kwargs) -> bytes:
        """Raw byte response (used for downloads)"""
        url = f"{self.base_url}{endpoint}"
        headers = self._get_auth_header()
        async with httpx.AsyncClient(verify=self.verify, timeout=self.timeout) as client:
            response = await client.request(method, url, headers=headers, **kwargs)
            response.raise_for_status()
            return response.content

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
    async def list_remote_backups(self, host: str = "this") -> Any:
        """GET /api/core/backup/backups/{host} - list remote configuration backups"""
        return await self._request("GET", f"/core/backup/backups/{host}")

    async def download_current_config(self, host: str = "this") -> bytes:
        """GET /api/core/backup/download/{host} - download current configuration as XML"""
        return await self._request_raw("GET", f"/core/backup/download/{host}")

    async def download_backup_by_name(self, host: str, filename: str) -> bytes:
        """GET /api/core/backup/download/{host}/{filename} - download specific backup"""
        return await self._request_raw("GET", f"/core/backup/download/{host}/{filename}")

    async def delete_remote_backup(self, filename: str) -> Dict[str, Any]:
        """POST /api/core/backup/delete_backup/{filename}"""
        return await self._request("POST", f"/core/backup/delete_backup/{filename}")

    async def revert_backup(self, filename: str) -> Dict[str, Any]:
        """POST /api/core/backup/revert_backup/{filename} - restore a remote backup"""
        return await self._request("POST", f"/core/backup/revert_backup/{filename}")

    # ===== Diagnostics: System =====
    async def get_system_information(self) -> Dict[str, Any]:
        """GET /api/diagnostics/system/systemInformation"""
        return await self._request("GET", "/diagnostics/system/systemInformation")

    async def get_system_resources(self) -> Dict[str, Any]:
        """GET /api/diagnostics/system/systemResources - memory, swap, etc."""
        return await self._request("GET", "/diagnostics/system/systemResources")

    async def get_system_time(self) -> Dict[str, Any]:
        """GET /api/diagnostics/system/systemTime - uptime, boottime"""
        return await self._request("GET", "/diagnostics/system/systemTime")

    async def get_system_disk(self) -> Dict[str, Any]:
        """GET /api/diagnostics/system/systemDisk"""
        return await self._request("GET", "/diagnostics/system/systemDisk")

    async def get_system_temperature(self) -> Any:
        """GET /api/diagnostics/system/systemTemperature"""
        return await self._request("GET", "/diagnostics/system/systemTemperature")

    async def get_system_memory(self) -> Dict[str, Any]:
        """GET /api/diagnostics/system/memory"""
        return await self._request("GET", "/diagnostics/system/memory")

    async def get_activity(self) -> Dict[str, Any]:
        """GET /api/diagnostics/activity/getActivity - returns top processes incl. CPU usage"""
        return await self._request("GET", "/diagnostics/activity/getActivity")

    async def get_cpu_type(self) -> Dict[str, Any]:
        """GET /api/diagnostics/cpu_usage/getCPUType"""
        return await self._request("GET", "/diagnostics/cpu_usage/getCPUType")

    async def get_systemhealth(self) -> Dict[str, Any]:
        """GET /api/diagnostics/systemhealth/getSystemHealth - RRD data"""
        return await self._request("GET", "/diagnostics/systemhealth/getSystemHealth")

    async def get_gateway_status(self) -> Dict[str, Any]:
        """GET /api/routes/gateway/status"""
        return await self._request("GET", "/routes/gateway/status")

    async def get_services_status(self) -> Dict[str, Any]:
        """GET /api/core/service/search"""
        # Modern OPNsense uses GET; older use POST. Try GET first.
        try:
            return await self._request("GET", "/core/service/search")
        except Exception:
            return await self._request("POST", "/core/service/search", json={})

    async def restart_service(self, identifier: str) -> Dict[str, Any]:
        """Restart a service via OPNsense core/service endpoints.

        OPNsense versions differ in how they address service actions. We try a
        few common variants and return the first successful response.
        """
        last_error = None
        candidates = [
            ("POST", f"/core/service/restart/{identifier}", None),
            ("POST", "/core/service/restart", {"service": identifier}),
            ("POST", "/core/service/restart", {"name": identifier}),
            ("POST", f"/core/service/reconfigure/{identifier}", None),
            ("POST", "/core/service/reconfigure", {"service": identifier}),
        ]
        for method, endpoint, payload in candidates:
            try:
                kwargs = {"json": payload} if payload is not None else {}
                return await self._request(method, endpoint, **kwargs)
            except Exception as e:
                last_error = e
                continue
        if last_error:
            raise last_error
        return {"status": "unknown"}

    async def start_service(self, identifier: str) -> Dict[str, Any]:
        """Start a service via OPNsense core/service endpoints."""
        last_error = None
        candidates = [
            ("POST", f"/core/service/start/{identifier}", None),
            ("POST", "/core/service/start", {"service": identifier}),
            ("POST", "/core/service/start", {"name": identifier}),
            ("POST", f"/core/service/reconfigure/{identifier}", None),
            ("POST", "/core/service/reconfigure", {"service": identifier}),
        ]
        for method, endpoint, payload in candidates:
            try:
                kwargs = {"json": payload} if payload is not None else {}
                return await self._request(method, endpoint, **kwargs)
            except Exception as e:
                last_error = e
                continue
        if last_error:
            raise last_error
        return {"status": "unknown"}

    async def get_arp_table(self) -> Dict[str, Any]:
        """GET /api/diagnostics/interface/getArp"""
        return await self._request("GET", "/diagnostics/interface/getArp")

    # ===== Logs endpoints =====
    async def _get_log(self, path: str, limit: int = 100) -> Any:
        """Fetch logs with pagination params (handles both 'rows' wrapper and plain arrays)"""
        # Newer OPNsense uses ?current=1&rowCount=N; older accepts ?limit=N
        params = {"current": 1, "rowCount": limit, "limit": limit}
        return await self._request("GET", path, params=params)

    async def _try_log_paths(self, paths: list, limit: int = 100) -> Any:
        """Try multiple endpoint paths in order, return the first that succeeds with non-empty data."""
        last_error = None
        for path in paths:
            try:
                data = await self._get_log(path, limit)
                # Any successful response wins; lenient because endpoints may be empty
                if data is not None:
                    return data
            except Exception as e:
                last_error = e
                continue
        if last_error:
            raise last_error
        return []

    async def get_firewall_logs(self, limit: int = 100) -> Any:
        """Firewall log - try new endpoint first, fall back to legacy"""
        return await self._try_log_paths([
            "/diagnostics/firewall/log",
            "/diagnostics/log/core/firewall",
            "/diagnostics/log/firewall",
        ], limit)

    async def get_system_logs(self, limit: int = 100) -> Any:
        """System log"""
        return await self._try_log_paths([
            "/diagnostics/log/core/system",
            "/diagnostics/log/system",
            "/diagnostics/log/core/general",
        ], limit)

    async def get_backend_logs(self, limit: int = 100) -> Any:
        """Backend (configd) log"""
        return await self._try_log_paths([
            "/diagnostics/log/core/configd",
            "/diagnostics/log/configd",
            "/diagnostics/log/core/backend",
        ], limit)

    # ===== S.M.A.R.T. endpoints (requires os-smart plugin) =====
    async def smart_list(self) -> Dict[str, Any]:
        """List SMART-capable devices with endpoint/method fallbacks."""
        last_error = None
        candidates = [
            ("POST", "/smart/service/list", {}),
            ("GET", "/smart/service/list", None),
            ("POST", "/smart/service/search", {}),
            ("GET", "/smart/service/search", None),
        ]
        for method, endpoint, payload in candidates:
            try:
                kwargs = {"json": payload} if payload is not None and method == "POST" else {}
                return await self._request(method, endpoint, **kwargs)
            except Exception as e:
                last_error = e
                continue
        if last_error:
            raise last_error
        return {}

    async def smart_info(self, device: str, dev_type: str = "auto") -> Dict[str, Any]:
        """Get SMART details for one device with endpoint/payload fallbacks."""
        last_error = None
        payloads = [
            {"device": device, "type": dev_type},
            {"dev": device, "type": dev_type},
            {"disk": device, "type": dev_type},
            {"device": device},
        ]
        for payload in payloads:
            for method, endpoint in [("POST", "/smart/service/info"), ("POST", "/smart/service/details")]:
                try:
                    return await self._request(method, endpoint, json=payload)
                except Exception as e:
                    last_error = e
                    continue
        if last_error:
            raise last_error
        return {}

    # ===== Restore (legacy) =====
    async def restore_backup(self, crypto: str, payload: str) -> Dict[str, Any]:
        """POST /api/core/backup/restore - upload a configuration XML (legacy; may not exist on all versions)"""
        data = {"crypto": crypto, "payload": payload}
        return await self._request("POST", "/core/backup/restore", json=data)
