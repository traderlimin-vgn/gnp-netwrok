"""Shared helpers: time, human-readable IDs, audit log, notifications, pagination."""

import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import os

from pymongo import ReturnDocument

from lib.db import db

TZ = ZoneInfo(os.environ.get("APP_TZ", "Asia/Jakarta"))


def uid() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def local_now() -> datetime:
    return datetime.now(TZ)


def today() -> str:
    return local_now().strftime("%Y-%m-%d")


def current_period() -> str:
    return local_now().strftime("%Y-%m")


async def next_seq(name: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return int(doc["seq"])


async def next_code(kind: str, period: str | None = None) -> str:
    """GMP-000001, INV-GMP-202610-000001, PAY-GMP-202610-000001, TKT-GMP-000001, PSB-GMP-000001, RTR-GMP-000001."""
    if kind in ("INV", "PAY"):
        p = (period or current_period()).replace("-", "")
        n = await next_seq(f"{kind}-{p}")
        return f"{kind}-GMP-{p}-{n:06d}"
    n = await next_seq(kind)
    return f"GMP-{n:06d}" if kind == "CUS" else f"{kind}-GMP-{n:06d}"


def clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc


async def audit(user: dict | None, action: str, entity: str = "", entity_id: str = "", detail: str = "", ip: str = "") -> None:
    await db.audit_logs.insert_one({
        "id": uid(), "created_at": now_iso(),
        "actor": (user or {}).get("email", "system"), "role": (user or {}).get("role", "system"),
        "action": action, "entity": entity, "entity_id": entity_id, "detail": detail, "ip": ip,
    })


async def notify(type_: str, title: str, message: str) -> None:
    await db.notifications.insert_one({
        "id": uid(), "type": type_, "title": title, "message": message, "read": False, "created_at": now_iso(),
    })


async def paginate(coll, query: dict, sort: list[tuple[str, int]], page: int, limit: int) -> dict:
    page = max(page, 1)
    limit = min(max(limit, 1), 200)
    total = await coll.count_documents(query)
    items = await coll.find(query, {"_id": 0}).sort(sort).skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"items": items, "total": total, "page": page, "limit": limit}


def regex_or(q: str, fields: list[str]) -> dict:
    import re
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    return {"$or": [{f: rx} for f in fields]}
