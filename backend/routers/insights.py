"""Dashboard, reports & exports, health check, backup."""

import csv
import io
import json
import os
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response

from lib.core import current_period, today, now_iso, audit, local_now
from lib.db import db
from lib.security import require
from lib.settings import get_settings

router = APIRouter()
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/app/backend/backups"))
BACKUP_COLLECTIONS = ["customers", "packages", "invoices", "payments", "mikrotik_routers", "mikrotik_actions", "tickets", "psb",
                      "whatsapp_messages", "audit_logs", "map_assets", "settings", "users"]


def _months(n: int) -> list[str]:
    d = local_now().replace(day=1)
    out = []
    y, m = d.year, d.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


async def _sum(coll, match: dict, field: str) -> int:
    r = await coll.aggregate([{"$match": match}, {"$group": {"_id": None, "s": {"$sum": f"${field}"}}}]).to_list(1)
    return int(r[0]["s"]) if r else 0


@router.get("/dashboard")
async def dashboard(_: dict = Depends(require("dashboard.view"))):
    period, t = current_period(), today()
    C = db.customers
    overdue_ids = await db.invoices.distinct("customer_id", {"status": "overdue"})
    routers = await db.mikrotik_routers.find({}, {"_id": 0, "password_enc": 0}).to_list(200)
    online_cust = await C.count_documents({"connection_status": "online"})
    linked = await C.count_documents({"router_id": {"$ne": ""}})
    stats = {
        "total_customers": await C.count_documents({}),
        "active": await C.count_documents({"status": "active"}),
        "suspend": await C.count_documents({"status": "suspend"}),
        "isolir": await C.count_documents({"status": "isolir"}),
        "arrears": len(overdue_ids),
        "billed_month": await _sum(db.invoices, {"period": period, "status": {"$ne": "cancelled"}}, "total"),
        "paid_month": await _sum(db.payments, {"status": "confirmed", "paid_at": {"$regex": f"^{period}"}}, "amount"),
        "revenue_today": await _sum(db.payments, {"status": "confirmed", "paid_at": {"$regex": f"^{t}"}}, "amount"),
        "new_customers": await C.count_documents({"install_date": {"$regex": f"^{period}"}}),
        "stopped_customers": await C.count_documents({"status": "stopped"}),
        "technicians": await db.users.count_documents({"role": "teknisi", "active": True}),
        "routers_online": sum(1 for r in routers if r.get("status") == "online"),
        "routers_offline": sum(1 for r in routers if r.get("status") != "online"),
        "pppoe_online": online_cust,
        "pppoe_offline": linked - online_cust,
        "open_tickets": await db.tickets.count_documents({"status": {"$nin": ["resolved", "closed"]}}),
        "pending_mikrotik": await db.mikrotik_pending.count_documents({"status": "pending"}),
    }
    stats["revenue_month"] = stats["paid_month"]
    months = _months(6)
    monthly = []
    for m in months:
        monthly.append({
            "period": m,
            "revenue": await _sum(db.payments, {"status": "confirmed", "paid_at": {"$regex": f"^{m}"}}, "amount"),
            "billed": await _sum(db.invoices, {"period": m, "status": {"$ne": "cancelled"}}, "total"),
            "payments": await db.payments.count_documents({"status": "confirmed", "paid_at": {"$regex": f"^{m}"}}),
            "invoices": await db.invoices.count_documents({"period": m}),
            "new_customers": await C.count_documents({"install_date": {"$regex": f"^{m}"}}),
            "customers": await C.count_documents({"install_date": {"$lte": f"{m}-31"}}),
        })
    status_dist = [{"status": s, "count": stats[k]} for s, k in (("Aktif", "active"), ("Isolir", "isolir"), ("Suspend", "suspend"), ("Berhenti", "stopped_customers"))]
    router_stats = []
    for r in routers:
        router_stats.append({"router": r["name"], "status": r.get("status", "unknown"), "cpu": r.get("cpu", 0),
                             "online": await C.count_documents({"router_id": r["id"], "connection_status": "online"}),
                             "offline": await C.count_documents({"router_id": r["id"], "connection_status": {"$ne": "online"}})})
    recent = await db.mikrotik_actions.find({}, {"_id": 0}).sort("created_at", -1).limit(8).to_list(8)
    return {"stats": stats, "monthly": monthly, "status_distribution": status_dist, "routers": router_stats, "recent_actions": recent}


@router.get("/reports")
async def reports(period: str = "", _: dict = Depends(require("reports.view"))):
    period = period or current_period()
    I, P = db.invoices, db.payments
    by_method = await P.aggregate([{"$match": {"status": "confirmed", "paid_at": {"$regex": f"^{period}"}}},
                                   {"$group": {"_id": "$method", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}]).to_list(10)
    techs = []
    for t in await db.users.find({"role": "teknisi"}, {"_id": 0}).to_list(100):
        techs.append({"name": t["name"],
                      "tickets_done": await db.tickets.count_documents({"technician_id": t["id"], "status": {"$in": ["resolved", "closed"]}}),
                      "tickets_pending": await db.tickets.count_documents({"technician_id": t["id"], "status": {"$nin": ["resolved", "closed"]}}),
                      "psb_done": await db.psb.count_documents({"technician_id": t["id"], "status": "done"}),
                      "psb_pending": await db.psb.count_documents({"technician_id": t["id"], "status": {"$nin": ["done", "cancelled"]}})})
    return {
        "period": period,
        "finance": {
            "revenue": await _sum(P, {"status": "confirmed", "paid_at": {"$regex": f"^{period}"}}, "amount"),
            "payments_count": await P.count_documents({"status": "confirmed", "paid_at": {"$regex": f"^{period}"}}),
            "billed": await _sum(I, {"period": period, "status": {"$ne": "cancelled"}}, "total"),
            "receivable": await _sum(I, {"status": {"$in": ["unpaid", "overdue"]}}, "total"),
            "overdue": await _sum(I, {"status": "overdue"}, "total"),
            "penalty": await _sum(I, {"period": period}, "penalty"),
            "discount": await _sum(I, {"period": period}, "discount"),
            "by_method": [{"method": r["_id"], "total": r["total"], "count": r["count"]} for r in by_method],
        },
        "customers": {
            "active": await db.customers.count_documents({"status": "active"}),
            "isolir": await db.customers.count_documents({"status": "isolir"}),
            "stopped": await db.customers.count_documents({"status": "stopped"}),
            "new": await db.customers.count_documents({"install_date": {"$regex": f"^{period}"}}),
        },
        "mikrotik": {
            "routers": await db.mikrotik_routers.count_documents({}),
            "routers_online": await db.mikrotik_routers.count_documents({"status": "online"}),
            "pppoe_online": await db.customers.count_documents({"connection_status": "online"}),
            "pppoe_offline": await db.customers.count_documents({"router_id": {"$ne": ""}, "connection_status": {"$ne": "online"}}),
            "api_errors": await db.mikrotik_actions.count_documents({"result": "FAILED", "created_at": {"$regex": f"^{period}"}}),
            "syncs": await db.mikrotik_actions.count_documents({"action": "SYNC", "created_at": {"$regex": f"^{period}"}}),
        },
        "technicians": techs,
    }


EXPORTS = {
    "customers": ("customers", ["customer_code", "name", "whatsapp", "address", "village", "district", "package_name", "package_price", "status", "router_name", "pppoe_username", "ip_address", "connection_status", "install_date"], "created_at"),
    "invoices": ("invoices", ["invoice_no", "customer_code", "customer_name", "period", "amount", "discount", "penalty", "total", "due_date", "status", "paid_at"], "created_at"),
    "payments": ("payments", ["payment_no", "invoice_no", "customer_code", "customer_name", "amount", "method", "reference", "status", "received_by", "paid_at"], "paid_at"),
    "tickets": ("tickets", ["ticket_no", "customer_name", "whatsapp", "complaint", "priority", "technician_name", "status", "reported_at", "resolved_at"], "reported_at"),
    "psb": ("psb", ["psb_no", "name", "whatsapp", "address", "package_name", "technician_name", "schedule", "status"], "created_at"),
    "mikrotik_actions": ("mikrotik_actions", ["created_at", "actor", "router_name", "action", "username", "reason", "result", "error_code", "message"], "created_at"),
}


@router.get("/reports/export")
async def export(kind: str, format: str = "csv", status: str = "", user: dict = Depends(require("reports.view"))):
    if kind not in EXPORTS or format not in ("csv", "xlsx"):
        raise HTTPException(400, "Jenis/format export tidak valid")
    coll, cols, sort = EXPORTS[kind]
    q = {"status": status} if status else {}
    rows = await db[coll].find(q, {"_id": 0}).sort(sort, -1).to_list(50000)
    await audit(user, "EXPORT", kind, "", f"{len(rows)} baris {format}")
    fname = f"gmp-{kind}-{today()}.{format}"
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])
        return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = kind
    ws.append(cols)
    for r in rows:
        ws.append([r.get(c, "") if not isinstance(r.get(c), (list, dict)) else str(r.get(c)) for c in cols])
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return StreamingResponse(out, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/health")
async def health():
    checks: dict = {"application": "ok"}
    try:
        await db.command("ping")
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"
    checks["redis"] = "not_configured (in-process job queue aktif)"
    checks["whatsapp_gateway"] = os.environ.get("WHATSAPP_PROVIDER", "simulator")
    routers = await db.mikrotik_routers.find({}, {"_id": 0, "status": 1}).to_list(500)
    checks["mikrotik"] = {"online": sum(r.get("status") == "online" for r in routers), "total": len(routers)}
    checks["storage"] = "ok" if Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads")).is_dir() else "missing"
    status = "ok" if checks["database"] == "ok" else "degraded"
    return {"status": status, "time": now_iso(), "checks": checks}


async def write_backup(reason: str = "auto") -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    data = {}
    for c in BACKUP_COLLECTIONS:
        data[c] = await db[c].find({}, {"_id": 0, "password_hash": 0}).to_list(100000)
    name = f"backup-{local_now().strftime('%Y%m%d-%H%M%S')}-{reason}.json"
    (BACKUP_DIR / name).write_text(json.dumps(data, default=str))
    files = sorted(BACKUP_DIR.glob("backup-*.json"))
    for old in files[:-14]:  # retention: keep latest 14
        old.unlink()
    return name


async def auto_backup_if_due() -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = local_now().strftime("%Y%m%d")
    if not list(BACKUP_DIR.glob(f"backup-{stamp}-*.json")):
        await write_backup("auto")


@router.get("/backups")
async def list_backups(_: dict = Depends(require("settings.manage"))):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return [{"name": f.name, "size": f.stat().st_size} for f in sorted(BACKUP_DIR.glob("backup-*.json"), reverse=True)]


@router.post("/backups")
async def create_backup(user: dict = Depends(require("settings.manage"))):
    name = await write_backup("manual")
    await audit(user, "BACKUP", "backup", name)
    return {"name": name}


@router.get("/backups/{name}")
async def download_backup(name: str, _: dict = Depends(require("settings.manage"))):
    path = BACKUP_DIR / Path(name).name
    if not path.is_file():
        raise HTTPException(404, "Backup tidak ditemukan")
    return Response(path.read_bytes(), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{path.name}"'})
