import base64
import logging
import re
from datetime import datetime, timezone
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
    """Best-effort update count parser for different OPNsense firmware payload shapes.

    Aggregates all signals (counters, package lists, upgrade sets, status_msg,
    version comparison, top-level "status" hint) and returns the maximum so an
    empty `upgrade_packages` array does not mask a non-empty `upgrade_sets`.

    A top-level "status" of "none" is treated as a definitive "no updates" and
    short-circuits all other heuristics — OPNsense reports this when the last
    firmware/check found nothing pending, regardless of revision suffixes
    (e.g. product_version="25.10.2_12" vs product_latest="25.10.2" only differ
    by package iteration, not by a real upgrade).
    """
    top_status_raw = status.get("status")
    if isinstance(top_status_raw, str) and top_status_raw.strip().lower() == "none":
        return 0

    candidates = [
        status.get("updates"),
        status.get("update_count"),
        status.get("updates_count"),
        status.get("upgrade_packages"),
        status.get("upgrade_sets"),
        status.get("all_sets"),
        status.get("new_packages"),
        status.get("reinstall_packages"),
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
            return len(v)
        return None

    parsed_counts = [p for p in (_parse(v) for v in candidates) if p is not None]
    best = max(parsed_counts) if parsed_counts else 0

    status_msg = status.get("status_msg")
    if isinstance(status_msg, str):
        # Explicit "up to date" wording overrides everything.
        msg_lower = status_msg.lower()
        if any(phrase in msg_lower for phrase in ("up to date", "up-to-date", "no updates", "no update available")):
            return 0
        m = re.search(r"(\d+)\s+update", msg_lower)
        if m:
            best = max(best, int(m.group(1)))

    # Top-level "status" of "upgrade" / "update" is a definitive >=1 signal on
    # OPNsense Business when packages lists arrive empty.
    top_status = status.get("status")
    if isinstance(top_status, str) and top_status.lower() in ("upgrade", "update", "pending"):
        best = max(best, 1)

    if best == 0:
        current_version = extract_firmware_version(status)
        latest_version = extract_latest_firmware_version(status)
        if current_version and latest_version:
            # Strip OPNsense package-revision suffix (e.g. "_12") so
            # "25.10.2_12" and "25.10.2" are considered the same release.
            cur_norm = re.sub(r"_\d+$", "", current_version)
            lat_norm = re.sub(r"_\d+$", "", latest_version)
            if cur_norm != lat_norm:
                best = 1

    return max(0, best)


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
    for key in ("product_id", "product_name", "product", "edition", "license", "license_type", "product_edition"):
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


_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S",
    "%d.%m.%Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%b %d %Y",
    "%b %d, %Y",
    "%B %d %Y",
    "%B %d, %Y",
)


def _parse_datelike(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        try:
            if value > 10_000_000_000:  # treat as milliseconds
                value = value / 1000
            if 0 < value < 4_102_444_800:  # < year 2100
                return datetime.fromtimestamp(float(value), tz=timezone.utc).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            return None
        return None
    if not isinstance(value, str):
        return None

    cleaned = value.strip()
    if not cleaned:
        return None

    try:
        return datetime.fromisoformat(cleaned.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        pass

    candidates = [cleaned]
    iso_match = re.search(r"\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?", cleaned)
    if iso_match:
        candidates.append(iso_match.group(0))
    dot_match = re.search(r"\b\d{1,2}\.\d{1,2}\.\d{2,4}\b", cleaned)
    if dot_match:
        candidates.append(dot_match.group(0))
    slash_match = re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b", cleaned)
    if slash_match:
        candidates.append(slash_match.group(0))

    for candidate in candidates:
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue
    return None


_EXPIRY_KEYS = (
    "license_expiry",
    "license_expires",
    "license_expires_at",
    "license_valid_until",
    "license_valid_to",
    "license_end",
    "subscription_expires",
    "subscription_expires_at",
    "subscription_valid_until",
    "subscription_valid_to",
    "subscription_end",
    "valid_until",
    "valid_to",
    "expires",
    "expires_at",
    "expiration",
    "expiration_date",
    "expire_date",
    "expiry",
    "expiry_date",
    "end_date",
    "end",
    "until",
)


def extract_license_expiry(payload: Dict[str, Any], _depth: int = 0) -> Optional[datetime]:
    """Best-effort license expiry extraction from arbitrary firmware/license payloads.

    Walks nested dicts looking for any of the known expiry-like keys. Limited
    recursion depth to avoid pathological payloads.
    """
    if not isinstance(payload, dict) or _depth > 6:
        return None

    for key in _EXPIRY_KEYS:
        parsed = _parse_datelike(payload.get(key))
        if parsed is not None:
            return parsed

    # Recurse into any nested dict whose key name suggests license/subscription
    # data (catches e.g. product.product_license.valid_to on OPNsense Business).
    interesting_substrings = ("licen", "subscrip", "product", "info", "details", "support", "maintenance", "expir", "valid")
    for key, value in payload.items():
        key_lower = key.lower() if isinstance(key, str) else ""
        if isinstance(value, dict) and any(s in key_lower for s in interesting_substrings):
            nested = extract_license_expiry(value, _depth + 1)
            if nested is not None:
                return nested
        elif isinstance(value, str) and any(s in key_lower for s in ("licen", "subscrip", "expir", "valid", "until", "support")):
            parsed = _parse_datelike(value)
            if parsed is not None:
                return parsed

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
        *,
        silent: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        """Make HTTP request to OPNsense API.

        Set silent=True when used inside a fallback chain where the caller will
        retry on failure; the failure is then logged at DEBUG instead of ERROR.
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
                detail = str(e) or e.__class__.__name__
                status_code = getattr(getattr(e, "response", None), "status_code", None)
                if status_code is not None:
                    detail = f"HTTP {status_code} {detail}".strip()
                msg = f"OPNsense API error on {self.host} {method} {endpoint}: {detail}"
                if silent:
                    logger.debug(msg)
                else:
                    logger.error(msg)
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

    async def get_firmware_info(self) -> Dict[str, Any]:
        """GET /api/core/firmware/info - richer payload incl. subscription on Business."""
        return await self._request("GET", "/core/firmware/info")

    async def get_firmware_config(self) -> Dict[str, Any]:
        """GET /api/core/firmware/get - read firmware settings (mirror, subscription, etc.)."""
        return await self._request("GET", "/core/firmware/get")

    async def set_firmware_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """POST /api/core/firmware/set - write firmware settings."""
        return await self._request("POST", "/core/firmware/set", json=config)

    async def update_subscription_key(self, subscription_key: str) -> Dict[str, Any]:
        """Update OPNsense Business subscription key via firmware config set endpoint."""
        current = await self.get_firmware_config()
        firmware = current.get("firmware") if isinstance(current, dict) else None
        if not isinstance(firmware, dict):
            firmware = {}

        firmware["subscription"] = subscription_key.strip()

        # Keep type as business when setting a Business subscription key.
        if not firmware.get("type"):
            firmware["type"] = "business"

        payload = {"firmware": firmware}
        return await self.set_firmware_config(payload)

    async def get_business_license(self) -> Dict[str, Any]:
        """Try Business-edition license endpoints with fallbacks; returns {} if unavailable."""
        candidates = [
            ("GET", "/business/license/status"),
            ("GET", "/business/license/info"),
            ("GET", "/business/service/status"),
        ]
        for method, endpoint in candidates:
            try:
                return await self._request(method, endpoint, silent=True)
            except Exception:
                continue
        return {}

    async def check_firmware_updates(self) -> Dict[str, Any]:
        """POST /api/core/firmware/check"""
        return await self._request("POST", "/core/firmware/check", json={})

    async def install_updates(self, target: str = "all") -> Dict[str, Any]:
        """POST /api/core/firmware/update.

        OPNsense's PHP backend reads POST parameters via getPost() (form-encoded),
        so we send form data, not JSON. An empty body has been observed to be
        ignored on some installs, leaving the request as a no-op. The "upgrade"
        parameter is accepted by both /update and /upgrade endpoints.
        """
        return await self._request("POST", "/core/firmware/update", data={"upgrade": target})

    async def upgrade_firmware(self, target: str = "pkg") -> Dict[str, Any]:
        """POST /api/core/firmware/upgrade.

        target values:
          * "pkg"             - package-only upgrade (safe default; does what
                                the "Update" button in the GUI does for plain
                                package upgrades)
          * "<release label>" - major release upgrade (e.g. "25.7" or whatever
                                product_latest from firmware/status reports)

        OPNsense expects form-encoded data here (Phalcon getPost()). An empty
        body falls into a default branch that does not perform a real upgrade.
        """
        return await self._request("POST", "/core/firmware/upgrade", data={"upgrade": target})

    async def get_upgrade_status(self) -> Dict[str, Any]:
        """GET /api/core/firmware/upgradestatus"""
        return await self._request("GET", "/core/firmware/upgradestatus")

    async def reboot_system(self) -> Dict[str, Any]:
        """POST /api/core/firmware/reboot"""
        return await self._request("POST", "/core/firmware/reboot", json={})

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
        return await self._request("POST", f"/core/backup/delete_backup/{filename}", json={})

    async def revert_backup(self, filename: str) -> Dict[str, Any]:
        """POST /api/core/backup/revert_backup/{filename} - restore a remote backup"""
        return await self._request("POST", f"/core/backup/revert_backup/{filename}", json={})

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
            return await self._request("GET", "/core/service/search", silent=True)
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
                return await self._request(method, endpoint, silent=True, **kwargs)
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
                return await self._request(method, endpoint, silent=True, **kwargs)
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
    async def _get_log(self, path: str, limit: int = 100, *, silent: bool = False) -> Any:
        """Fetch logs with pagination params (handles both 'rows' wrapper and plain arrays)"""
        # Newer OPNsense uses ?current=1&rowCount=N; older accepts ?limit=N
        params = {"current": 1, "rowCount": limit, "limit": limit}
        return await self._request("GET", path, silent=silent, params=params)

    async def _try_log_paths(self, paths: list, limit: int = 100) -> Any:
        """Try multiple endpoint paths in order, return the first that succeeds with non-empty data."""
        last_error = None
        for path in paths:
            try:
                data = await self._get_log(path, limit, silent=True)
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
                return await self._request(method, endpoint, silent=True, **kwargs)
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
                    return await self._request(method, endpoint, silent=True, json=payload)
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
