import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from integrations.whatsapp.service import WhatsAppService, maps_link
from lib.core import uid, now_iso, next_code, audit, notify, paginate, regex_or, clean
from lib.db import db
from lib.security import require, current_user
from models.schemas import (Notification, Paged, Psb, PsbIn, PsbUpdate, Ticket, TicketIn, TicketUpdate, UploadOut, User,
                            WhatsAppMessage, WhatsAppSendIn, MapPoint, AuditLog)

router = APIRouter()
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}


async def _tech(tid: str) -> dict:
    if not tid:
        return {}
    t = await db.users.find_one({"id": tid, "role": "teknisi"}, {"_id": 0})
    if not t:
        raise HTTPException(422, "Teknisi tidak ditemukan")
    return t


def _teknisi_scope(user: dict, query: dict) -> dict:
    if user["role"] == "teknisi":
        query["technician_id"] = user["id"]
    return query


# ---------- technicians ----------
@router.get("/technicians", response_model=list[User])
async def technicians(_: dict = Depends(current_user)):
    return await db.users.find({"role": "teknisi", "active": True}, {"_id": 0, "password_hash": 0}).to_list(200)


# ---------- tickets ----------
@router.get("/tickets", response_model=Paged[Ticket])
async def list_tickets(q: str = "", status: str = "", priority: str = "", technician_id: str = "", page: int = 1, limit: int = 20,
                       user: dict = Depends(require("tickets.view"))):
    query: dict = regex_or(q, ["ticket_no", "customer_name", "whatsapp", "address", "complaint"]) if q else {}
    for k, v in (("status", status), ("priority", priority), ("technician_id", technician_id)):
        if v:
            query[k] = v
    return await paginate(db.tickets, _teknisi_scope(user, query), [("reported_at", -1)], page, limit)


@router.post("/tickets", response_model=Ticket)
async def create_ticket(body: TicketIn, actor: dict = Depends(require("tickets.write"))):
    c = await db.customers.find_one({"id": body.customer_id}, {"_id": 0})
    if not c:
        raise HTTPException(422, "Pelanggan tidak ditemukan")
    tech = await _tech(body.technician_id or c.get("technician_id", ""))
    doc = {"id": uid(), "ticket_no": await next_code("TKT"), "customer_id": c["id"], "customer_name": c["name"],
           "whatsapp": c["whatsapp"], "address": c.get("address", ""), "latitude": c.get("latitude"), "longitude": c.get("longitude"),
           "complaint": body.complaint, "priority": body.priority, "technician_id": tech.get("id", ""),
           "technician_name": tech.get("name", ""), "status": "assigned" if tech else "open", "photos": [], "notes": body.notes,
           "reported_at": now_iso(), "resolved_at": None}
    await db.tickets.insert_one(doc)
    await audit(actor, "TAMBAH_TIKET", "ticket", doc["id"], f"{doc['ticket_no']} {c['name']}")
    await notify("ticket_new", "Tiket baru", f"{doc['ticket_no']} — {c['name']}: {body.complaint[:60]}")
    if tech.get("phone"):
        await WhatsAppService.send_template("ticket_technician", tech["phone"], tech["name"], {
            "ticket": doc["ticket_no"], "nama": c["name"], "nomor": c["whatsapp"], "alamat": c.get("address"),
            "keluhan": body.complaint, "google_maps_link": maps_link(c.get("latitude"), c.get("longitude"))})
    return clean(doc)


@router.patch("/tickets/{id}", response_model=Ticket)
async def update_ticket(id: str, body: TicketUpdate, actor: dict = Depends(require("tickets.write"))):
    t = await db.tickets.find_one({"id": id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Tiket tidak ditemukan")
    if actor["role"] == "teknisi" and t.get("technician_id") != actor["id"]:
        raise HTTPException(403, "Tiket ini bukan milik Anda")
    patch: dict = {}
    update: dict = {}
    if body.status:
        patch["status"] = body.status
        if body.status in ("resolved", "closed") and not t.get("resolved_at"):
            patch["resolved_at"] = now_iso()
    if body.priority:
        patch["priority"] = body.priority
    if body.notes is not None:
        patch["notes"] = body.notes
    if body.technician_id is not None and actor["role"] != "teknisi":
        tech = await _tech(body.technician_id)
        patch.update(technician_id=tech.get("id", ""), technician_name=tech.get("name", ""))
        if tech and t["status"] == "open":
            patch["status"] = "assigned"
        if tech.get("phone") and tech.get("id") != t.get("technician_id"):
            await WhatsAppService.send_template("ticket_technician", tech["phone"], tech["name"], {
                "ticket": t["ticket_no"], "nama": t["customer_name"], "nomor": t["whatsapp"], "alamat": t["address"],
                "keluhan": t["complaint"], "google_maps_link": maps_link(t.get("latitude"), t.get("longitude"))})
    if patch:
        update["$set"] = patch
    if body.photo_url:
        update["$push"] = {"photos": body.photo_url}
    if update:
        await db.tickets.update_one({"id": id}, update)
    await audit(actor, "UPDATE_TIKET", "ticket", id, f"{t['ticket_no']} {patch.get('status', '')}")
    return await db.tickets.find_one({"id": id}, {"_id": 0})


# ---------- PSB ----------
@router.get("/psb", response_model=Paged[Psb])
async def list_psb(q: str = "", status: str = "", page: int = 1, limit: int = 20, user: dict = Depends(require("psb.view"))):
    query: dict = regex_or(q, ["psb_no", "name", "whatsapp", "address"]) if q else {}
    if status:
        query["status"] = status
    return await paginate(db.psb, _teknisi_scope(user, query), [("created_at", -1)], page, limit)


@router.post("/psb", response_model=Psb)
async def create_psb(body: PsbIn, actor: dict = Depends(require("psb.write"))):
    pkg = await db.packages.find_one({"id": body.package_id})
    if not pkg:
        raise HTTPException(422, "Paket tidak ditemukan")
    tech = await _tech(body.technician_id)
    doc = {**body.model_dump(), "id": uid(), "psb_no": await next_code("PSB"), "package_name": pkg["name"],
           "technician_name": tech.get("name", ""), "status": "scheduled" if tech and body.schedule else "new",
           "photos": [], "customer_id": "", "created_at": now_iso()}
    await db.psb.insert_one(doc)
    await audit(actor, "TAMBAH_PSB", "psb", doc["id"], f"{doc['psb_no']} {doc['name']}")
    await notify("psb_new", "PSB baru", f"{doc['psb_no']} — {doc['name']} ({pkg['name']})")
    if tech.get("phone"):
        await WhatsAppService.send_template("psb_technician", tech["phone"], tech["name"], {
            "psb": doc["psb_no"], "nama": doc["name"], "nomor": doc["whatsapp"], "alamat": doc["address"], "paket": pkg["name"],
            "jadwal": doc["schedule"], "google_maps_link": maps_link(doc.get("latitude"), doc.get("longitude"))})
    return clean(doc)


@router.patch("/psb/{id}", response_model=Psb)
async def update_psb(id: str, body: PsbUpdate, actor: dict = Depends(require("tickets.write"))):
    p = await db.psb.find_one({"id": id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "PSB tidak ditemukan")
    if actor["role"] == "teknisi" and p.get("technician_id") != actor["id"]:
        raise HTTPException(403, "PSB ini bukan milik Anda")
    patch = {k: v for k, v in body.model_dump(exclude={"photo_url", "technician_id"}).items() if v is not None}
    if body.technician_id is not None and actor["role"] != "teknisi":
        tech = await _tech(body.technician_id)
        patch.update(technician_id=tech.get("id", ""), technician_name=tech.get("name", ""))
    update: dict = {"$set": patch} if patch else {}
    if body.photo_url:
        update["$push"] = {"photos": body.photo_url}
    if update:
        await db.psb.update_one({"id": id}, update)
    await audit(actor, "UPDATE_PSB", "psb", id, f"{p['psb_no']} {patch.get('status', '')}")
    return await db.psb.find_one({"id": id}, {"_id": 0})


# ---------- technician dashboard ----------
@router.get("/technician/me")
async def technician_me(user: dict = Depends(require("technician.view"))):
    q = {"technician_id": user["id"]} if user["role"] == "teknisi" else {}
    tickets = await db.tickets.find(q, {"_id": 0}).sort("reported_at", -1).to_list(100)
    psb = await db.psb.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    customers = await db.customers.find(q, {"_id": 0, "pppoe_password_enc": 0}).sort("name", 1).to_list(200)
    return {"tickets": tickets, "psb": psb, "customers": customers}


# ---------- map ----------
@router.get("/map/points", response_model=list[MapPoint])
async def map_points(_: dict = Depends(require("map.view"))):
    pts: list[dict] = []
    async for c in db.customers.find({"latitude": {"$ne": None}}, {"_id": 0}):
        pts.append({"id": c["id"], "type": "customer", "name": c["name"], "latitude": c["latitude"], "longitude": c["longitude"],
                    "status": c["status"], "info": f"{c['customer_code']} · {c.get('package_name', '')} · {c.get('pppoe_username', '')}"})
    async for a in db.map_assets.find({}, {"_id": 0}):
        pts.append({"id": a["id"], "type": a["type"], "name": a["name"], "latitude": a["latitude"], "longitude": a["longitude"],
                    "info": f"Kapasitas {a.get('used', 0)}/{a.get('capacity', 0)}", "parent_id": a.get("parent_id", "")})
    async for t in db.users.find({"role": "teknisi", "latitude": {"$ne": None}}, {"_id": 0}):
        pts.append({"id": t["id"], "type": "technician", "name": t["name"], "latitude": t["latitude"], "longitude": t["longitude"], "info": t.get("phone", "")})
    async for p in db.psb.find({"status": {"$nin": ["done", "cancelled"]}, "latitude": {"$ne": None}}, {"_id": 0}):
        pts.append({"id": p["id"], "type": "psb", "name": p["name"], "latitude": p["latitude"], "longitude": p["longitude"], "status": p["status"], "info": p["psb_no"]})
    async for t in db.tickets.find({"status": {"$nin": ["resolved", "closed"]}, "latitude": {"$ne": None}}, {"_id": 0}):
        pts.append({"id": t["id"], "type": "ticket", "name": t["customer_name"], "latitude": t["latitude"], "longitude": t["longitude"], "status": t["priority"], "info": f"{t['ticket_no']} · {t['complaint'][:50]}"})
    async for r in db.mikrotik_routers.find({"latitude": {"$ne": None}}, {"_id": 0}):
        pts.append({"id": r["id"], "type": "router", "name": r["name"], "latitude": r["latitude"], "longitude": r["longitude"], "status": r.get("status", ""), "info": r.get("location", "")})
    return pts


# ---------- whatsapp ----------
@router.post("/whatsapp/send", response_model=WhatsAppMessage)
async def wa_send(body: WhatsAppSendIn, actor: dict = Depends(require("whatsapp.send"))):
    msg = await WhatsAppService.send(body.to, body.message, body.name)
    await audit(actor, "KIRIM_WHATSAPP", "whatsapp", msg["id"], body.to)
    return msg


@router.get("/whatsapp/messages", response_model=Paged[WhatsAppMessage])
async def wa_messages(q: str = "", template: str = "", page: int = 1, limit: int = 30, _: dict = Depends(require("billing.view"))):
    query: dict = regex_or(q, ["to", "name", "message"]) if q else {}
    if template:
        query["template"] = template
    return await paginate(db.whatsapp_messages, query, [("created_at", -1)], page, limit)


# ---------- notifications / audit ----------
@router.get("/notifications", response_model=list[Notification])
async def notifications(_: dict = Depends(current_user)):
    return await db.notifications.find({}, {"_id": 0}).sort("created_at", -1).limit(30).to_list(30)


@router.post("/notifications/read-all")
async def read_all(_: dict = Depends(current_user)):
    await db.notifications.update_many({"read": False}, {"$set": {"read": True}})
    return {"ok": True}


@router.get("/audit-logs", response_model=Paged[AuditLog])
async def audit_logs(q: str = "", action: str = "", page: int = 1, limit: int = 30, _: dict = Depends(require("audit.view"))):
    query: dict = regex_or(q, ["actor", "action", "detail", "entity"]) if q else {}
    if action:
        query["action"] = action
    return await paginate(db.audit_logs, query, [("created_at", -1)], page, limit)


# ---------- uploads (bukti bayar, foto tiket) ----------
@router.post("/uploads", response_model=UploadOut)
async def upload(file: UploadFile = File(...), _: dict = Depends(current_user)):
    ext = ALLOWED.get(file.content_type or "")
    if not ext:
        raise HTTPException(422, "Format file harus JPG, PNG, WEBP atau PDF")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(422, "Ukuran file maksimal 5 MB")
    name = uid() + ext
    (UPLOAD_DIR / name).write_bytes(data)
    return {"url": f"/api/uploads/{name}"}


@router.get("/uploads/{name}")
async def get_upload(name: str, _: dict = Depends(current_user)):
    path = (UPLOAD_DIR / Path(name).name)
    if not path.is_file():
        raise HTTPException(404, "File tidak ditemukan")
    return FileResponse(path)
