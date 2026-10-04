from fastapi import APIRouter, Depends, HTTPException

from integrations.mikrotik.services import MikroTikCustomerService, MikroTikBillingService, MikroTikError, log_action, MikroTikConnectionService
from lib.core import uid, now_iso, next_code, audit, paginate, regex_or, clean
from lib.db import db
from lib.security import require, encrypt_secret
from models.schemas import Customer, CustomerIn, CustomerSaveResult, Package, PackageIn, Paged

router = APIRouter()
SORTS = {"newest": [("created_at", -1)], "name": [("name", 1)], "code": [("customer_code", 1)], "due": [("due_day", 1)]}


def to_out(c: dict) -> dict:
    c["has_pppoe_password"] = bool(c.pop("pppoe_password_enc", ""))
    return c


async def _denorm(body: CustomerIn) -> dict:
    pkg = await db.packages.find_one({"id": body.package_id})
    if not pkg:
        raise HTTPException(422, "Paket tidak ditemukan")
    tech = await db.users.find_one({"id": body.technician_id, "role": "teknisi"}) if body.technician_id else None
    rtr = await db.mikrotik_routers.find_one({"id": body.router_id}) if body.router_id else None
    if body.router_id and not rtr:
        raise HTTPException(422, "Router MikroTik tidak ditemukan")
    data = body.model_dump(exclude={"pppoe_password", "create_pppoe"})
    data.update(package_name=pkg["name"], package_price=pkg["price"], technician_name=(tech or {}).get("name", ""),
                router_name=(rtr or {}).get("name", ""))
    if body.pppoe_password:
        data["pppoe_password_enc"] = encrypt_secret(body.pppoe_password)
    return data


# ---------- packages ----------
@router.get("/packages", response_model=list[Package])
async def list_packages(_: dict = Depends(require("customers.view"))):
    pk = await db.packages.find({}, {"_id": 0}).sort("price", 1).to_list(200)
    counts = {r["_id"]: r["n"] for r in await db.customers.aggregate([{"$match": {"status": {"$ne": "stopped"}}}, {"$group": {"_id": "$package_id", "n": {"$sum": 1}}}]).to_list(200)}
    return [{**p, "subscribers": counts.get(p["id"], 0)} for p in pk]


@router.post("/packages", response_model=Package)
async def create_package(body: PackageIn, actor: dict = Depends(require("packages.write"))):
    doc = {**body.model_dump(), "id": uid(), "created_at": now_iso()}
    await db.packages.insert_one(doc)
    await audit(actor, "TAMBAH_PAKET", "package", doc["id"], doc["name"])
    return clean(doc)


@router.put("/packages/{id}", response_model=Package)
async def update_package(id: str, body: PackageIn, actor: dict = Depends(require("packages.write"))):
    res = await db.packages.find_one_and_update({"id": id}, {"$set": body.model_dump()}, projection={"_id": 0}, return_document=True)
    if not res:
        raise HTTPException(404, "Paket tidak ditemukan")
    await audit(actor, "EDIT_PAKET", "package", id, body.name)
    return res


@router.delete("/packages/{id}")
async def delete_package(id: str, actor: dict = Depends(require("packages.write"))):
    if await db.customers.count_documents({"package_id": id, "status": {"$ne": "stopped"}}):
        raise HTTPException(409, "Paket masih dipakai pelanggan aktif — nonaktifkan saja")
    await db.packages.delete_one({"id": id})
    await audit(actor, "HAPUS_PAKET", "package", id)
    return {"ok": True}


# ---------- customers ----------
@router.get("/customers", response_model=Paged[Customer])
async def list_customers(q: str = "", status: str = "", router_id: str = "", package_id: str = "", technician_id: str = "",
                         arrears: bool = False, sort: str = "newest", page: int = 1, limit: int = 20,
                         _: dict = Depends(require("customers.view"))):
    query: dict = {}
    if q:
        query.update(regex_or(q, ["name", "whatsapp", "customer_code", "pppoe_username", "address", "ip_address", "mac_address"]))
    for k, v in (("status", status), ("router_id", router_id), ("package_id", package_id), ("technician_id", technician_id)):
        if v:
            query[k] = v
    if arrears:
        query["id"] = {"$in": await db.invoices.distinct("customer_id", {"status": "overdue"})}
    res = await paginate(db.customers, query, SORTS.get(sort, SORTS["newest"]), page, limit)
    ids = [c["id"] for c in res["items"]]
    unpaid = {r["_id"]: r["n"] for r in await db.invoices.aggregate([
        {"$match": {"customer_id": {"$in": ids}, "status": {"$in": ["unpaid", "overdue"]}}},
        {"$group": {"_id": "$customer_id", "n": {"$sum": 1}}}]).to_list(500)}
    res["items"] = [to_out({**c, "unpaid_count": unpaid.get(c["id"], 0)}) for c in res["items"]]
    return res


@router.get("/customers/{id}", response_model=Customer)
async def get_customer(id: str, _: dict = Depends(require("customers.view"))):
    c = await db.customers.find_one({"id": id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    return to_out(c)


@router.post("/customers", response_model=CustomerSaveResult)
async def create_customer(body: CustomerIn, actor: dict = Depends(require("customers.write"))):
    if body.pppoe_username and await db.customers.find_one({"pppoe_username": body.pppoe_username, "router_id": body.router_id}):
        raise HTTPException(409, "Username PPPoE sudah dipakai di router ini")
    data = await _denorm(body)
    pkg = await db.packages.find_one({"id": body.package_id})
    data.update(id=uid(), customer_code=await next_code("CUS"), created_at=now_iso(), connection_status="unknown",
                integration_status="NOT_LINKED" if not body.router_id else "PENDING", pppoe_profile=pkg.get("mikrotik_profile", ""))
    await db.customers.insert_one(data)
    await audit(actor, "TAMBAH_PELANGGAN", "customer", data["id"], f"{data['customer_code']} {data['name']}")
    result = "SKIPPED"
    if body.create_pppoe and body.router_id and body.pppoe_username:
        result = await MikroTikCustomerService.create_secret(data, body.pppoe_password or body.pppoe_username, pkg.get("mikrotik_profile") or "default",
                                                             body.service or "pppoe", body.comment or f"{data['customer_code']} {data['name']}", actor["email"])
    c = await db.customers.find_one({"id": data["id"]}, {"_id": 0})
    return {"customer": to_out(c), "mikrotik_result": result}


@router.put("/customers/{id}", response_model=CustomerSaveResult)
async def update_customer(id: str, body: CustomerIn, actor: dict = Depends(require("customers.write"))):
    old = await db.customers.find_one({"id": id}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    data = await _denorm(body)
    if body.status == "stopped" and old["status"] != "stopped":
        data["stopped_at"] = now_iso()
    await db.customers.update_one({"id": id}, {"$set": data})
    await audit(actor, "EDIT_PELANGGAN", "customer", id, old["name"])
    result = "SKIPPED"
    new = await db.customers.find_one({"id": id}, {"_id": 0})
    if body.create_pppoe and body.router_id and body.pppoe_username and not old.get("mikrotik_id"):
        pkg = await db.packages.find_one({"id": body.package_id}) or {}
        result = await MikroTikCustomerService.create_secret(new, body.pppoe_password or body.pppoe_username, pkg.get("mikrotik_profile") or "default",
                                                             body.service or "pppoe", body.comment or new["customer_code"], actor["email"])
    elif old.get("package_id") != body.package_id and new.get("router_id") and new.get("pppoe_username"):
        pkg = await db.packages.find_one({"id": body.package_id}) or {}
        old_pkg = await db.packages.find_one({"id": old.get("package_id")}) or {}
        if pkg.get("mikrotik_profile") and new.get("status") != "isolir":
            result = await MikroTikBillingService.execute(new, [("UPDATE_PROFILE", "set_profile", (pkg["mikrotik_profile"],))], actor["email"],
                                                          f"Ganti paket {old_pkg.get('mikrotik_profile', '-')} → {pkg['mikrotik_profile']}")
            if result == "SUCCESS":
                await db.customers.update_one({"id": id}, {"$set": {"pppoe_profile": pkg["mikrotik_profile"]}})
    return {"customer": to_out(await db.customers.find_one({"id": id}, {"_id": 0})), "mikrotik_result": result}


@router.delete("/customers/{id}")
async def delete_customer(id: str, remove_pppoe: bool = False, actor: dict = Depends(require("customers.delete"))):
    c = await db.customers.find_one({"id": id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    if remove_pppoe and c.get("router_id") and c.get("pppoe_username"):
        rtr = await db.mikrotik_routers.find_one({"id": c["router_id"]}, {"_id": 0})
        try:
            await MikroTikConnectionService.call(rtr, "delete_pppoe_user", c["pppoe_username"])
            await log_action(rtr, "DELETE_USER", "SUCCESS", actor["email"], c["pppoe_username"], c, "Hapus pelanggan")
        except MikroTikError as e:
            await log_action(rtr, "DELETE_USER", "FAILED", actor["email"], c["pppoe_username"], c, "Hapus pelanggan", e.code, e.message)
    await db.customers.delete_one({"id": id})
    await audit(actor, "HAPUS_PELANGGAN", "customer", id, f"{c['customer_code']} {c['name']}")
    return {"ok": True}
