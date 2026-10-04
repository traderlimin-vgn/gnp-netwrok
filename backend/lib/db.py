"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "users": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "sessions": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                 IndexModel([("expires_at", ASCENDING)], name="ttl", expireAfterSeconds=0)],
    "customers": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                  IndexModel([("customer_code", ASCENDING)], name="code", unique=True),
                  IndexModel([("router_id", ASCENDING), ("pppoe_username", ASCENDING)], name="router_ppp"),
                  IndexModel([("status", ASCENDING), ("created_at", DESCENDING)], name="status_created"),
                  IndexModel([("technician_id", ASCENDING)], name="tech")],
    "packages": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "invoices": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                 IndexModel([("invoice_no", ASCENDING)], name="no", unique=True),
                 IndexModel([("customer_id", ASCENDING), ("period", ASCENDING)], name="cust_period"),
                 IndexModel([("status", ASCENDING), ("due_date", ASCENDING)], name="status_due"),
                 IndexModel([("created_at", DESCENDING)], name="created")],
    "payments": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                 IndexModel([("invoice_id", ASCENDING)], name="invoice"),
                 IndexModel([("status", ASCENDING), ("paid_at", DESCENDING)], name="status_paid")],
    "mikrotik_routers": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "mikrotik_actions": [IndexModel([("created_at", DESCENDING)], name="created"),
                         IndexModel([("router_id", ASCENDING), ("created_at", DESCENDING)], name="router_created")],
    "mikrotik_pending": [IndexModel([("status", ASCENDING), ("router_id", ASCENDING)], name="status_router")],
    "sim_ppp": [IndexModel([("router_id", ASCENDING), ("name", ASCENDING)], name="router_name", unique=True)],
    "tickets": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("technician_id", ASCENDING), ("reported_at", DESCENDING)], name="tech_reported")],
    "psb": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("technician_id", ASCENDING), ("created_at", DESCENDING)], name="tech_created")],
    "whatsapp_messages": [IndexModel([("created_at", DESCENDING)], name="created")],
    "audit_logs": [IndexModel([("created_at", DESCENDING)], name="created")],
    "notifications": [IndexModel([("created_at", DESCENDING)], name="created")],
    "jobs": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("status", ASCENDING)], name="status")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
