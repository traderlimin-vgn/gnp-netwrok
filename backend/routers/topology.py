"""Topology management (ODC / ODP / tiang + cable routes) and fault history."""

import math

from fastapi import APIRouter, Depends, HTTPException

from lib.core import audit, now_iso, paginate, uid
from lib.db import db
from lib.security import require
from models.schemas import Paged
from models.topology import Cable, CableIn, FaultHistory, FaultHotspot, MapAsset, MapAssetIn

router = APIRouter()
MANAGE = "mikrotik.routers"  # super_admin + admin


def _length(path: list[list[float]]) -> float:
    def hav(a, b):
        la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
        h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
        return 6_371_000 * 2 * math.asin(math.sqrt(h))
    return round(sum(hav(path[i], path[i + 1]) for i in range(len(path) - 1)), 1)


async def _validate_parent(body: MapAssetIn, self_id: str = "") -> None:
    if not body.parent_id:
        return
    p = await db.map_assets.find_one({"id": body.parent_id})
    want = {"odp": "odc", "pole": None, "odc": None}[body.type]
    if not p or p["id"] == self_id or (want and p["type"] != want):
        raise HTTPException(422, "Induk tidak valid (ODP harus di bawah ODC)")


@router.get("/map/assets", response_model=list[MapAsset])
async def list_assets(type: str = "", _: dict = Depends(require("map.view"))):
    items = await db.map_assets.find({"type": type} if type else {}, {"_id": 0}).sort("name", 1).to_list(5000)
    used = {r["_id"]: r["n"] for r in await db.customers.aggregate([{"$match": {"status": {"$ne": "stopped"}}}, {"$group": {"_id": "$odp_id", "n": {"$sum": 1}}}]).to_list(5000)}
    kids = {r["_id"]: r["n"] for r in await db.map_assets.aggregate([{"$group": {"_id": "$parent_id", "n": {"$sum": 1}}}]).to_list(5000)}
    return [{**a, "used": used.get(a["id"], 0) if a["type"] == "odp" else kids.get(a["id"], 0), "children": kids.get(a["id"], 0)} for a in items]


@router.post("/map/assets", response_model=MapAsset)
async def create_asset(body: MapAssetIn, actor: dict = Depends(require(MANAGE))):
    await _validate_parent(body)
    if await db.map_assets.find_one({"name": body.name, "type": body.type}):
        raise HTTPException(409, f"{body.type.upper()} dengan nama {body.name} sudah ada")
    doc = {**body.model_dump(), "id": uid(), "created_at": now_iso()}
    await db.map_assets.insert_one(doc)
    await audit(actor, "TAMBAH_ASET_JARINGAN", body.type, doc["id"], body.name)
    return {**doc, "used": 0, "children": 0}


@router.put("/map/assets/{id}", response_model=MapAsset)
async def update_asset(id: str, body: MapAssetIn, actor: dict = Depends(require(MANAGE))):
    old = await db.map_assets.find_one({"id": id}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Aset tidak ditemukan")
    await _validate_parent(body, id)
    await db.map_assets.update_one({"id": id}, {"$set": body.model_dump()})
    if body.type == "odp" and body.name != old["name"]:
        await db.customers.update_many({"odp_id": id}, {"$set": {"odp_name": body.name}})
    await audit(actor, "EDIT_ASET_JARINGAN", body.type, id, body.name)
    return {**old, **body.model_dump(), "used": await db.customers.count_documents({"odp_id": id}), "children": await db.map_assets.count_documents({"parent_id": id})}


@router.delete("/map/assets/{id}")
async def delete_asset(id: str, actor: dict = Depends(require(MANAGE))):
    a = await db.map_assets.find_one({"id": id})
    if not a:
        raise HTTPException(404, "Aset tidak ditemukan")
    if await db.map_assets.count_documents({"parent_id": id}) or await db.customers.count_documents({"odp_id": id}):
        raise HTTPException(409, "Aset masih memiliki ODP/pelanggan terhubung — pindahkan dulu")
    await db.map_assets.delete_one({"id": id})
    await db.cable_routes.delete_many({"$or": [{"from_id": id}, {"to_id": id}]})
    await audit(actor, "HAPUS_ASET_JARINGAN", a["type"], id, a["name"])
    return {"ok": True}


async def _names(ids: set[str]) -> dict[str, str]:
    return {a["id"]: a["name"] async for a in db.map_assets.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "name": 1})}


@router.get("/map/cables", response_model=list[Cable])
async def list_cables(_: dict = Depends(require("map.view"))):
    items = await db.cable_routes.find({}, {"_id": 0}).to_list(5000)
    names = await _names({x for c in items for x in (c["from_id"], c["to_id"]) if x})
    return [{**c, "from_name": names.get(c["from_id"], ""), "to_name": names.get(c["to_id"], "")} for c in items]


async def _save_cable(body: CableIn, id: str) -> dict:
    for k in (body.from_id, body.to_id):
        if k and not await db.map_assets.find_one({"id": k}):
            raise HTTPException(422, "Titik awal/akhir kabel tidak ditemukan")
    doc = {**body.model_dump(), "id": id, "length_m": _length(body.path)}
    if not doc["name"]:
        n = await _names({body.from_id, body.to_id})
        doc["name"] = f"{body.kind.upper()} {n.get(body.from_id, '?')} → {n.get(body.to_id, '?')}"
    await db.cable_routes.update_one({"id": id}, {"$set": doc}, upsert=True)
    n = await _names({body.from_id, body.to_id})
    return {**doc, "from_name": n.get(body.from_id, ""), "to_name": n.get(body.to_id, "")}


@router.post("/map/cables", response_model=Cable)
async def create_cable(body: CableIn, actor: dict = Depends(require(MANAGE))):
    c = await _save_cable(body, uid())
    await audit(actor, "TAMBAH_JALUR_KABEL", "cable", c["id"], f"{c['name']} {c['length_m']} m")
    return c


@router.put("/map/cables/{id}", response_model=Cable)
async def update_cable(id: str, body: CableIn, actor: dict = Depends(require(MANAGE))):
    if not await db.cable_routes.find_one({"id": id}):
        raise HTTPException(404, "Jalur kabel tidak ditemukan")
    c = await _save_cable(body, id)
    await audit(actor, "EDIT_JALUR_KABEL", "cable", id, c["name"])
    return c


@router.delete("/map/cables/{id}")
async def delete_cable(id: str, actor: dict = Depends(require(MANAGE))):
    if not (await db.cable_routes.delete_one({"id": id})).deleted_count:
        raise HTTPException(404, "Jalur kabel tidak ditemukan")
    await audit(actor, "HAPUS_JALUR_KABEL", "cable", id)
    return {"ok": True}


@router.get("/network/fault-history", response_model=Paged[FaultHistory])
async def fault_history(status: str = "", level: str = "", q: str = "", page: int = 1, limit: int = 30, _: dict = Depends(require("map.view"))):
    query: dict = {k: v for k, v in (("status", status), ("level", level)) if v}
    if q:
        query["segment"] = {"$regex": q, "$options": "i"}
    return await paginate(db.fault_history, query, [("started_at", -1)], page, limit)


@router.get("/network/fault-history/hotspots", response_model=list[FaultHotspot])
async def hotspots(days: int = 90, _: dict = Depends(require("map.view"))):
    from datetime import datetime, timedelta, timezone
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = await db.fault_history.aggregate([
        {"$match": {"started_at": {"$gte": since}}}, {"$sort": {"started_at": 1}},
        {"$group": {"_id": "$fault_key", "segment": {"$last": "$segment"}, "level": {"$last": "$level"}, "count": {"$sum": 1},
                    "total_duration_min": {"$sum": "$duration_min"}, "affected_max": {"$max": "$affected_max"}, "last_at": {"$last": "$started_at"},
                    "open": {"$max": {"$cond": [{"$eq": ["$status", "open"]}, 1, 0]}}, "latitude": {"$last": "$latitude"}, "longitude": {"$last": "$longitude"}}},
        {"$sort": {"count": -1, "total_duration_min": -1}}, {"$limit": 50}]).to_list(50)
    return [{**r, "open": bool(r["open"])} for r in rows]
