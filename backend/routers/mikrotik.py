import asyncio
from fastapi import APIRouter, Depends, HTTPException

from integrations.mikrotik.base import MikroTikError
from integrations.mikrotik.services import (MikroTikBillingService, MikroTikConnectionService, MikroTikCustomerService, log_action)
from lib.core import uid, now_iso, next_code, audit, paginate, regex_or, clean
from lib.db import db
from lib.security import encrypt_secret, require
from lib.settings import get_settings, save_settings
from models.schemas import (ActionResult, MikrotikAction, Paged, PendingAction, PppSession, Router, RouterIn, Settings, SyncResult, TestResult)

router = APIRouter()


def router_out(r: dict, customers: int = 0) -> dict:
    r = {k: v for k, v in r.items() if k != "password_enc"} | {"has_password": bool(r.get("password_enc"))}
    r["connection_type"] = "api-ssl" if r.get("ssl_enabled") else "api"
    r["customers"] = customers
    return r


async def _get_router(id: str) -> dict:
    r = await db.mikrotik_routers.find_one({"id": id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Router tidak ditemukan")
    return r


def _err(e: MikroTikError):
    status = 503 if e.code in ("MIKROTIK_TIMEOUT", "MIKROTIK_CONNECTION_FAILED", "MIKROTIK_ROUTER_OFFLINE", "MIKROTIK_DISABLED") else 502
    return HTTPException(status, {"code": e.code, "message": e.message})


@router.get("/mikrotik/routers", response_model=list[Router])
async def list_routers(_: dict = Depends(require("mikrotik.view"))):
    counts = {r["_id"]: r["n"] for r in await db.customers.aggregate([{"$group": {"_id": "$router_id", "n": {"$sum": 1}}}]).to_list(500)}
    rows = await db.mikrotik_routers.find({}, {"_id": 0}).sort("router_code", 1).to_list(500)
    return [router_out(r, counts.get(r["id"], 0)) for r in rows]


@router.post("/mikrotik/routers", response_model=Router)
async def create_router(body: RouterIn, actor: dict = Depends(require("mikrotik.routers"))):
    if not body.password:
        raise HTTPException(422, "Password user API wajib diisi")
    if await db.mikrotik_routers.find_one({"name": body.name}):
        raise HTTPException(409, "Nama router sudah ada")
    doc = {**body.model_dump(exclude={"password"}), "password_enc": encrypt_secret(body.password), "id": uid(),
           "router_code": await next_code("RTR"), "status": "unknown", "created_at": now_iso(), "last_test_ok": False}
    await db.mikrotik_routers.insert_one(doc)
    await audit(actor, "TAMBAH_ROUTER", "router", doc["id"], f"{doc['name']} {doc['host']} ({'API-SSL' if body.ssl_enabled else 'API'})")
    return router_out(clean(doc))


@router.put("/mikrotik/routers/{id}", response_model=Router)
async def update_router(id: str, body: RouterIn, actor: dict = Depends(require("mikrotik.routers"))):
    await _get_router(id)
    patch = body.model_dump(exclude={"password"})
    if body.password:
        patch["password_enc"] = encrypt_secret(body.password)
    patch["last_test_ok"] = False  # config changed → must re-test before automation
    await db.mikrotik_routers.update_one({"id": id}, {"$set": patch})
    await audit(actor, "UBAH_KONFIGURASI_ROUTER", "router", id, f"{body.name} {body.host}{' (password diganti)' if body.password else ''}")
    return router_out(await _get_router(id))


@router.delete("/mikrotik/routers/{id}")
async def delete_router(id: str, actor: dict = Depends(require("mikrotik.routers"))):
    r = await _get_router(id)
    if await db.customers.count_documents({"router_id": id}):
        raise HTTPException(409, "Router masih memiliki pelanggan")
    await db.mikrotik_routers.delete_one({"id": id})
    await audit(actor, "HAPUS_ROUTER", "router", id, r["name"])
    return {"ok": True}


@router.post("/mikrotik/routers/{id}/test", response_model=TestResult)
async def test_router(id: str, actor: dict = Depends(require("mikrotik.routers"))):
    r = await _get_router(id)
    res = await MikroTikConnectionService.test(r, actor["email"])
    await audit(actor, "TEST_CONNECTION", "router", id, f"{r['name']}: {'OK' if res['success'] else res['error_code']}")
    return res


@router.post("/mikrotik/routers/{id}/sync", response_model=SyncResult)
async def sync_router(id: str, actor: dict = Depends(require("mikrotik.control"))):
    try:
        return await MikroTikCustomerService.sync_router(await _get_router(id), actor["email"])
    except MikroTikError as e:
        raise _err(e)


@router.get("/mikrotik/routers/{id}/identity")
async def identity(id: str, _: dict = Depends(require("mikrotik.view"))):
    try:
        return {"identity": await MikroTikConnectionService.call(await _get_router(id), "get_identity")}
    except MikroTikError as e:
        raise _err(e)


@router.get("/mikrotik/routers/{id}/system")
async def system(id: str, _: dict = Depends(require("mikrotik.view"))):
    r = await _get_router(id)
    h = await MikroTikConnectionService.health(r)
    interfaces: list = []
    if h["status"] == "online":
        try:
            interfaces = await MikroTikConnectionService.call(r, "get_interfaces")
        except MikroTikError:
            pass
    return {"router": router_out(h), "interfaces": interfaces}


async def _sessions(r: dict) -> list[dict]:
    custs = {c["pppoe_username"]: c for c in await db.customers.find({"router_id": r["id"], "pppoe_username": {"$ne": ""}}, {"_id": 0}).to_list(5000)}
    try:
        secrets = await MikroTikConnectionService.call(r, "get_ppp_secrets", )
        active = {a["name"]: a for a in await MikroTikConnectionService.call(r, "get_ppp_active")}
        traffic = {t["interface"]: t for t in await MikroTikConnectionService.call(r, "get_traffic")}
    except MikroTikError:
        return [{"router_id": r["id"], "router_name": r["name"], "username": u, "customer_id": c["id"], "customer_name": c["name"],
                 "profile": c.get("pppoe_profile", ""), "status": "unknown", "disabled": c.get("mikrotik_disabled", False)} for u, c in custs.items()]
    out = []
    for s in secrets:
        a = active.get(s["name"])
        c = custs.get(s["name"], {})
        t = traffic.get(f"<pppoe-{s['name']}>", {})
        up = (a or {}).get("uptime", "")
        status = "offline" if not a else ("connecting" if up.startswith("00h00m") and len(up) <= 9 else "online")
        out.append({"router_id": r["id"], "router_name": r["name"], "username": s["name"], "customer_id": c.get("id", ""),
                    "customer_name": c.get("name", s.get("comment", "")), "address": (a or {}).get("address", ""),
                    "caller_id": (a or {}).get("caller-id", (a or {}).get("caller_id", "")), "uptime": up,
                    "service": s.get("service", "pppoe"), "profile": s.get("profile", ""),
                    "interface": f"<pppoe-{s['name']}>" if a else "", "status": status, "disabled": bool(s.get("disabled")),
                    "rx_bps": t.get("rx_bps", 0), "tx_bps": t.get("tx_bps", 0)})
    return out


@router.get("/mikrotik/routers/{id}/pppoe", response_model=list[PppSession])
async def router_pppoe(id: str, _: dict = Depends(require("mikrotik.view"))):
    return await _sessions(await _get_router(id))


@router.get("/mikrotik/pppoe", response_model=list[PppSession])
async def all_pppoe(router_id: str = "", status: str = "", q: str = "", _: dict = Depends(require("mikrotik.view"))):
    routers = await db.mikrotik_routers.find({"id": router_id} if router_id else {}, {"_id": 0}).to_list(100)
    rows: list[dict] = [x for part in await asyncio.gather(*(_sessions(r) for r in routers)) for x in part]
    if status:
        rows = [x for x in rows if x["status"] == status]
    if q:
        ql = q.lower()
        rows = [x for x in rows if ql in f"{x['username']} {x['customer_name']} {x.get('address', '')} {x.get('caller_id', '')}".lower()]
    return rows


@router.post("/mikrotik/customers/{id}/{action}", response_model=ActionResult)
async def customer_action(id: str, action: str, actor: dict = Depends(require("mikrotik.control"))):
    if action not in ("enable", "disable", "disconnect", "isolate", "activate"):
        raise HTTPException(404, "Aksi tidak dikenal")
    c = await db.customers.find_one({"id": id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    if not c.get("router_id") or not c.get("pppoe_username"):
        raise HTTPException(400, "Pelanggan belum terhubung ke router / PPPoE")
    if action == "isolate":
        res = await MikroTikBillingService.isolate(c, "Isolir manual oleh admin", actor["email"])
    elif action == "activate":
        res = await MikroTikBillingService.activate(c, "Aktivasi manual oleh admin", actor["email"])
    else:
        res = await MikroTikCustomerService.manual(c, action, actor["email"], f"Manual {action} oleh admin")
    msgs = {"SUCCESS": "Berhasil dijalankan di MikroTik", "PENDING": "Router offline — aksi masuk antrian retry",
            "FAILED": "Gagal — lihat MikroTik Action Log", "SKIPPED": "Tidak ada perubahan diperlukan"}
    return {"result": res, "message": msgs.get(res, res)}


@router.get("/mikrotik/actions", response_model=Paged[MikrotikAction])
async def actions(q: str = "", action: str = "", result: str = "", router_id: str = "", page: int = 1, limit: int = 30,
                  _: dict = Depends(require("mikrotik.view"))):
    query: dict = {}
    if q:
        query.update(regex_or(q, ["username", "customer_name", "actor", "reason", "message"]))
    for k, v in (("action", action), ("result", result), ("router_id", router_id)):
        if v:
            query[k] = v
    return await paginate(db.mikrotik_actions, query, [("created_at", -1)], page, limit)


@router.get("/mikrotik/pending", response_model=list[PendingAction])
async def pending(_: dict = Depends(require("mikrotik.view"))):
    return await db.mikrotik_pending.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/mikrotik/pending/retry")
async def retry(_: dict = Depends(require("mikrotik.control"))):
    return await MikroTikBillingService.retry_pending()


@router.get("/settings", response_model=Settings)
async def read_settings(_: dict = Depends(require("dashboard.view"))):
    return await get_settings()


@router.put("/settings", response_model=Settings)
async def write_settings(body: Settings, actor: dict = Depends(require("settings.manage"))):
    cur = await get_settings()
    turning_on = (body.auto_isolation and not cur["auto_isolation"]) or (body.auto_activation and not cur["auto_activation"])
    if turning_on and not await db.mikrotik_routers.find_one({"last_test_ok": True}):
        raise HTTPException(409, "Lakukan TEST CONNECTION yang berhasil pada minimal satu router sebelum mengaktifkan otomasi")
    res = await save_settings(body.model_dump())
    await audit(actor, "UBAH_PENGATURAN", "settings", "app", ", ".join(f"{k}={v}" for k, v in body.model_dump().items() if cur.get(k) != v))
    return res
