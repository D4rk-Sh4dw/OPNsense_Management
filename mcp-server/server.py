"""
OPNsense CMS – MCP Server
Exposes all CMS functionality as MCP tools for use with AI assistants.

Start: python server.py
Or via stdio: python server.py --transport stdio
"""

import os
import json
import httpx
import asyncio
from typing import Any
from dotenv import load_dotenv
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    Tool,
    TextContent,
    CallToolResult,
)

load_dotenv()

CMS_API_URL = os.getenv("CMS_API_URL", "http://localhost:8000")
HTTP_TIMEOUT = 30.0

app = Server("opnsense-cms")


# ─────────────────────────────────────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────────────────────────────────────

async def _get(path: str, params: dict = None) -> Any:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.get(f"{CMS_API_URL}{path}", params=params)
        r.raise_for_status()
        return r.json()


async def _post(path: str, body: dict = None) -> Any:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.post(f"{CMS_API_URL}{path}", json=body or {})
        r.raise_for_status()
        return r.json()


async def _patch(path: str, body: dict) -> Any:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.patch(f"{CMS_API_URL}{path}", json=body)
        r.raise_for_status()
        return r.json()


async def _delete(path: str) -> Any:
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        r = await client.delete(f"{CMS_API_URL}{path}")
        r.raise_for_status()
        return r.json()


def _ok(data: Any) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=json.dumps(data, indent=2, default=str))])


def _err(msg: str) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=f"ERROR: {msg}")], isError=True)


# ─────────────────────────────────────────────────────────────────────────────
# Tool registry
# ─────────────────────────────────────────────────────────────────────────────

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [

        # ── Dashboard ──────────────────────────────────────────────────────
        Tool(
            name="get_dashboard_summary",
            description=(
                "Gibt eine Zusammenfassung des gesamten Firewall-Parks zurück: "
                "Anzahl Firewalls, online/offline, ausstehende Updates, kritische Alarme."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),

        # ── Firewalls ──────────────────────────────────────────────────────
        Tool(
            name="list_firewalls",
            description="Listet alle verwalteten OPNsense-Firewalls mit Basisdaten auf.",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="get_firewall",
            description="Gibt Details einer einzelnen Firewall inkl. aktuellen Status, letzten Backups und offenen Alarmen zurück.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string", "description": "UUID der Firewall"}
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="add_firewall",
            description="Fügt eine neue OPNsense-Firewall zur Verwaltung hinzu.",
            inputSchema={
                "type": "object",
                "properties": {
                    "customer_name": {"type": "string", "description": "Kundenname"},
                    "hostname":      {"type": "string", "description": "Hostname der Firewall"},
                    "ip":            {"type": "string", "description": "IP-Adresse der Firewall"},
                    "api_key":       {"type": "string", "description": "OPNsense API-Key"},
                    "api_secret":    {"type": "string", "description": "OPNsense API-Secret (wird verschlüsselt gespeichert)"},
                    "notify_email":  {"type": "string", "description": "E-Mail für Benachrichtigungen"},
                    "verify_ssl":    {"type": "boolean", "description": "SSL-Zertifikat prüfen (Standard: false)", "default": False},
                    "license_expiry":{"type": "string", "description": "Lizenzablauf (ISO 8601, z.B. 2026-08-15T00:00:00)"},
                    "auto_update":   {"type": "boolean", "description": "Automatische Updates aktivieren", "default": False},
                    "auto_update_window": {"type": "string", "description": "Wartungsfenster, z.B. sun:02:00"},
                    "backup_interval":    {"type": "string", "description": "daily oder weekly"},
                    "notes":         {"type": "string", "description": "Freitext-Notizen"},
                    "tags":          {"type": "array", "items": {"type": "string"}, "description": "Tags für Gruppierung"},
                },
                "required": ["customer_name", "ip", "api_key", "api_secret"],
            },
        ),
        Tool(
            name="update_firewall",
            description="Aktualisiert Konfigurationsfelder einer vorhandenen Firewall.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id":   {"type": "string"},
                    "customer_name": {"type": "string"},
                    "hostname":      {"type": "string"},
                    "notify_email":  {"type": "string"},
                    "auto_update":   {"type": "boolean"},
                    "auto_update_window": {"type": "string"},
                    "backup_interval":    {"type": "string"},
                    "backup_retention":   {"type": "integer"},
                    "license_expiry":     {"type": "string"},
                    "notes":         {"type": "string"},
                    "tags":          {"type": "array", "items": {"type": "string"}},
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="delete_firewall",
            description="Entfernt eine Firewall aus der Verwaltung (ACHTUNG: löscht auch alle zugehörigen Statusdaten und Alarme).",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"}
                },
                "required": ["firewall_id"],
            },
        ),

        # ── Monitoring ─────────────────────────────────────────────────────
        Tool(
            name="check_firewall_health",
            description="Führt sofort einen manuellen Health-Check für eine Firewall durch und gibt CPU, RAM, Firmware, Gateway-Status zurück.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"}
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="get_firewall_status",
            description="Gibt den zuletzt gespeicherten Monitoring-Status (aus der Datenbank) einer Firewall zurück.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"}
                },
                "required": ["firewall_id"],
            },
        ),

        # ── Backups ────────────────────────────────────────────────────────
        Tool(
            name="list_backups",
            description="Listet alle lokal gespeicherten Backups einer Firewall auf.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"},
                    "limit":       {"type": "integer", "default": 20},
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="create_backup",
            description="Erstellt sofort ein Backup der Firewall-Konfiguration und speichert es lokal.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id":   {"type": "string"},
                    "triggered_by":  {"type": "string", "default": "manual"},
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="restore_backup",
            description="Spielt ein gespeichertes Backup auf eine Firewall ein (Zero-Touch Restore). ACHTUNG: Firewall startet ggf. neu.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"},
                    "backup_id":  {"type": "string", "description": "UUID des Backup-Eintrags"},
                },
                "required": ["firewall_id", "backup_id"],
            },
        ),
        Tool(
            name="delete_backup",
            description="Löscht ein lokales Backup dauerhaft.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"},
                    "backup_id":  {"type": "string"},
                },
                "required": ["firewall_id", "backup_id"],
            },
        ),

        # ── Updates ────────────────────────────────────────────────────────
        Tool(
            name="check_updates",
            description="Prüft, ob Firmware-Updates für eine Firewall verfügbar sind.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"}
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="install_updates",
            description=(
                "Startet die Firmware-Installation auf einer Firewall (inkl. automatischem Pre-Update-Backup). "
                "Der Prozess läuft im Hintergrund; Status abrufbar über get_update_history."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"}
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="get_update_history",
            description="Gibt die Firmware-Update-Historie einer Firewall zurück.",
            inputSchema={
                "type": "object",
                "properties": {
                    "firewall_id": {"type": "string"},
                    "limit":       {"type": "integer", "default": 10},
                },
                "required": ["firewall_id"],
            },
        ),
        Tool(
            name="get_pending_updates",
            description="Listet alle Firewalls auf, für die derzeit Firmware-Updates verfügbar sind.",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),

        # ── Alerts ─────────────────────────────────────────────────────────
        Tool(
            name="list_alerts",
            description="Listet Alarme auf. Filter: severity (info/warning/critical), resolved (true/false).",
            inputSchema={
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["info", "warning", "critical"]},
                    "resolved": {"type": "boolean", "default": False},
                    "limit":    {"type": "integer", "default": 50},
                },
                "required": [],
            },
        ),
        Tool(
            name="resolve_alert",
            description="Markiert einen Alarm als behoben.",
            inputSchema={
                "type": "object",
                "properties": {
                    "alert_id": {"type": "string"}
                },
                "required": ["alert_id"],
            },
        ),
        Tool(
            name="delete_alert",
            description="Löscht einen Alarm dauerhaft.",
            inputSchema={
                "type": "object",
                "properties": {
                    "alert_id": {"type": "string"}
                },
                "required": ["alert_id"],
            },
        ),
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Tool execution
# ─────────────────────────────────────────────────────────────────────────────

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> CallToolResult:
    try:
        match name:

            # ── Dashboard ──────────────────────────────────────────────────
            case "get_dashboard_summary":
                data = await _get("/api/firewalls/dashboard/summary")
                return _ok(data)

            # ── Firewalls ──────────────────────────────────────────────────
            case "list_firewalls":
                data = await _get("/api/firewalls")
                return _ok(data)

            case "get_firewall":
                fid = arguments["firewall_id"]
                data = await _get(f"/api/firewalls/{fid}")
                return _ok(data)

            case "add_firewall":
                data = await _post("/api/firewalls", arguments)
                return _ok(data)

            case "update_firewall":
                fid = arguments.pop("firewall_id")
                data = await _patch(f"/api/firewalls/{fid}", arguments)
                return _ok(data)

            case "delete_firewall":
                fid = arguments["firewall_id"]
                await _delete(f"/api/firewalls/{fid}")
                return _ok({"message": f"Firewall {fid} gelöscht"})

            # ── Monitoring ─────────────────────────────────────────────────
            case "check_firewall_health":
                fid = arguments["firewall_id"]
                data = await _post(f"/api/firewalls/{fid}/check-health")
                return _ok(data)

            case "get_firewall_status":
                fid = arguments["firewall_id"]
                data = await _get(f"/api/firewalls/{fid}/status")
                return _ok(data)

            # ── Backups ────────────────────────────────────────────────────
            case "list_backups":
                fid = arguments["firewall_id"]
                limit = arguments.get("limit", 20)
                data = await _get(f"/api/backups/firewalls/{fid}", params={"limit": limit})
                return _ok(data)

            case "create_backup":
                fid = arguments["firewall_id"]
                body = {"triggered_by": arguments.get("triggered_by", "manual")}
                data = await _post(f"/api/backups/firewalls/{fid}/create", body)
                return _ok(data)

            case "restore_backup":
                fid = arguments["firewall_id"]
                bid = arguments["backup_id"]
                data = await _post(f"/api/backups/firewalls/{fid}/restore", {"backup_id": bid})
                return _ok(data)

            case "delete_backup":
                fid = arguments["firewall_id"]
                bid = arguments["backup_id"]
                data = await _delete(f"/api/backups/firewalls/{fid}/backups/{bid}")
                return _ok(data)

            # ── Updates ────────────────────────────────────────────────────
            case "check_updates":
                fid = arguments["firewall_id"]
                data = await _post(f"/api/updates/firewalls/{fid}/check")
                return _ok(data)

            case "install_updates":
                fid = arguments["firewall_id"]
                data = await _post(f"/api/updates/firewalls/{fid}/install")
                return _ok(data)

            case "get_update_history":
                fid = arguments["firewall_id"]
                limit = arguments.get("limit", 10)
                data = await _get(f"/api/updates/firewalls/{fid}/history", params={"limit": limit})
                return _ok(data)

            case "get_pending_updates":
                data = await _get("/api/updates/pending")
                return _ok(data)

            # ── Alerts ─────────────────────────────────────────────────────
            case "list_alerts":
                params = {k: v for k, v in arguments.items() if v is not None}
                data = await _get("/api/alerts", params=params)
                return _ok(data)

            case "resolve_alert":
                aid = arguments["alert_id"]
                data = await _post(f"/api/alerts/{aid}/resolve")
                return _ok(data)

            case "delete_alert":
                aid = arguments["alert_id"]
                data = await _delete(f"/api/alerts/{aid}")
                return _ok(data)

            case _:
                return _err(f"Unbekanntes Tool: {name}")

    except httpx.HTTPStatusError as e:
        return _err(f"HTTP {e.response.status_code}: {e.response.text}")
    except httpx.ConnectError:
        return _err(f"Verbindung zu CMS-Backend fehlgeschlagen: {CMS_API_URL}")
    except Exception as e:
        return _err(str(e))


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
