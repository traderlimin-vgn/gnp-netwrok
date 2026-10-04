"""Lightweight in-process job queue (BullMQ-style contract: named jobs, persisted status, retries).
Heavy work (MikroTik sync, isolation, activation, WhatsApp) never runs on the HTTP request path."""

import asyncio
import logging
from typing import Awaitable, Callable

from lib.core import uid, now_iso
from lib.db import db

logger = logging.getLogger("jobs")
_queue: asyncio.Queue | None = None
_handlers: dict[str, Callable[[dict], Awaitable[dict | None]]] = {}


def handler(name: str):
    def deco(fn):
        _handlers[name] = fn
        return fn
    return deco


async def enqueue(name: str, payload: dict) -> str:
    job_id = uid()
    await db.jobs.insert_one({"id": job_id, "name": name, "payload": payload, "status": "queued", "created_at": now_iso()})
    if _queue is not None:
        await _queue.put(job_id)
    return job_id


async def _worker() -> None:
    assert _queue is not None
    while True:
        job_id = await _queue.get()
        job = await db.jobs.find_one({"id": job_id})
        if not job:
            continue
        try:
            await db.jobs.update_one({"id": job_id}, {"$set": {"status": "running", "started_at": now_iso()}})
            result = await _handlers[job["name"]](job["payload"])
            await db.jobs.update_one({"id": job_id}, {"$set": {"status": "done", "result": result, "finished_at": now_iso()}})
        except Exception as exc:  # job failure must never kill the worker
            logger.exception("job %s failed", job["name"])
            await db.jobs.update_one({"id": job_id}, {"$set": {"status": "failed", "error": str(exc), "finished_at": now_iso()}})


async def start_workers(n: int = 2) -> list[asyncio.Task]:
    global _queue
    _queue = asyncio.Queue()
    for job in await db.jobs.find({"status": {"$in": ["queued", "running"]}}).to_list(500):
        await _queue.put(job["id"])
    return [asyncio.create_task(_worker()) for _ in range(n)]
