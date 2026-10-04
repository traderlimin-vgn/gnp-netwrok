"""App settings (MikroTik integration + billing). Protocol: MikroTik API (8728) only, automation OFF until tested."""

from lib.db import db

DEFAULTS = {
    "mikrotik_enabled": True,
    "default_protocol": "api",
    "api_port": 8728,
    "timeout_ms": 10000,
    "retry_count": 3,
    "polling_interval": 30,
    "auto_sync": False,
    "auto_isolation": False,
    "auto_activation": False,
    "grace_days": 3,
    "isolation_methods": ["disable_secret", "disconnect"],
    "isolation_profile": "ISOLIR",
    "due_day": 10,
    "late_fee": 0,
    "company_name": "NETWORK GMP",
    "company_phone": "6281234500000",
    "company_address": "Krian, Sidoarjo, Jawa Timur",
    "whatsapp_provider": "simulator",
}


async def get_settings() -> dict:
    doc = await db.settings.find_one({"_id": "app"}) or {}
    doc.pop("_id", None)
    return {**DEFAULTS, **doc}


async def save_settings(patch: dict) -> dict:
    await db.settings.update_one({"_id": "app"}, {"$set": patch}, upsert=True)
    return await get_settings()
