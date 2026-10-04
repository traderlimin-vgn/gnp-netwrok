"""Billing service: invoice generation, overdue marking, auto-isolation run, payment application.
Side effects (WhatsApp, MikroTik) are dispatched through the job queue."""

import calendar

from fastapi import HTTPException

from integrations.mikrotik.services import MikroTikBillingService, MikroTikCustomerService, MikroTikConnectionService
from integrations.whatsapp.service import WhatsAppService, rupiah
from lib.core import uid, now_iso, today, current_period, next_code, audit, notify
from lib.db import db
from lib.jobs import handler, enqueue
from lib.settings import get_settings

from datetime import date, timedelta


def due_date_for(period: str, due_day: int) -> str:
    y, m = map(int, period.split("-"))
    return date(y, m, min(due_day, calendar.monthrange(y, m)[1])).isoformat()


async def generate_invoices(period: str, actor: dict) -> dict:
    period = period or current_period()
    created = skipped = 0
    new_ids: list[str] = []
    async for c in db.customers.find({"status": {"$in": ["active", "isolir", "suspend"]}}, {"_id": 0}):
        if await db.invoices.find_one({"customer_id": c["id"], "period": period, "status": {"$ne": "cancelled"}}):
            skipped += 1
            continue
        amount = int(c.get("package_price", 0))
        inv = {"id": uid(), "invoice_no": await next_code("INV", period), "customer_id": c["id"], "customer_name": c["name"],
               "customer_code": c["customer_code"], "whatsapp": c.get("whatsapp", ""), "package_name": c.get("package_name", ""),
               "period": period, "amount": amount, "discount": 0, "penalty": 0, "total": amount,
               "due_date": due_date_for(period, int(c.get("due_day", 10))), "status": "unpaid", "paid_at": None, "created_at": now_iso()}
        await db.invoices.insert_one(inv)
        new_ids.append(inv["id"])
        created += 1
    job_id = await enqueue("send_invoice_whatsapp", {"invoice_ids": new_ids}) if new_ids else ""
    await audit(actor, "GENERATE_INVOICE", "invoice", period, f"{created} invoice dibuat, {skipped} dilewati")
    if created:
        await notify("invoice_created", "Invoice dibuat", f"{created} invoice periode {period} berhasil dibuat")
    return {"period": period, "created": created, "skipped": skipped, "job_id": job_id}


@handler("send_invoice_whatsapp")
async def _send_invoice_wa(payload: dict):
    sent = 0
    for inv in await db.invoices.find({"id": {"$in": payload["invoice_ids"]}}, {"_id": 0}).to_list(10000):
        await WhatsAppService.send_template("invoice", inv["whatsapp"], inv["customer_name"], {
            "nama": inv["customer_name"], "invoice": inv["invoice_no"], "periode": inv["period"],
            "total": rupiah(inv["total"]), "tanggal": inv["due_date"]})
        sent += 1
    return {"sent": sent}


async def mark_overdue() -> int:
    s = await get_settings()
    t = today()
    overdue = await db.invoices.find({"status": "unpaid", "due_date": {"$lt": t}}, {"_id": 0}).to_list(10000)
    for inv in overdue:
        fee = int(s["late_fee"])
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "overdue", "penalty": inv["penalty"] + fee,
                                                                   "total": inv["total"] + fee}})
    if overdue:
        await notify("invoice_overdue", "Invoice overdue", f"{len(overdue)} invoice melewati jatuh tempo")
    return len(overdue)


async def run_automation(actor: str = "system") -> dict:
    s = await get_settings()
    marked = await mark_overdue()
    isolated = skipped = 0
    if s["auto_isolation"]:
        limit = (date.fromisoformat(today()) - timedelta(days=int(s["grace_days"]))).isoformat()
        cust_ids = await db.invoices.distinct("customer_id", {"status": "overdue", "due_date": {"$lt": limit}})
        for c in await db.customers.find({"id": {"$in": cust_ids}, "status": "active"}, {"_id": 0}).to_list(10000):
            res = await MikroTikBillingService.isolate(c, "Invoice overdue melewati grace period", actor)
            if res == "SKIPPED" and c.get("router_id"):
                skipped += 1
            else:
                isolated += 1
    return {"overdue_marked": marked, "isolated": isolated, "skipped": skipped, "auto_isolation": s["auto_isolation"]}


async def finalize_payment(payment: dict, actor: dict) -> None:
    inv = await db.invoices.find_one({"id": payment["invoice_id"]}, {"_id": 0})
    await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "paid", "paid_at": payment["paid_at"]}})
    await audit(actor, "PEMBAYARAN", "payment", payment["id"], f"{payment['payment_no']} {inv['invoice_no']} {rupiah(payment['amount'])}")
    await notify("payment_received", "Pembayaran diterima", f"{payment['customer_name']} — {inv['invoice_no']} {rupiah(payment['amount'])}")
    await enqueue("after_payment", {"payment_id": payment["id"], "actor": actor.get("email", "system")})


@handler("after_payment")
async def _after_payment(payload: dict):
    p = await db.payments.find_one({"id": payload["payment_id"]}, {"_id": 0})
    await WhatsAppService.send_template("payment", p["whatsapp"], p["customer_name"], {"invoice": p["invoice_no"], "total": rupiah(p["amount"])})
    c = await db.customers.find_one({"id": p["customer_id"]}, {"_id": 0})
    if not c:
        return {"activation": "NO_CUSTOMER"}
    still_overdue = await db.invoices.count_documents({"customer_id": c["id"], "status": "overdue"})
    if c.get("status") == "isolir" and not still_overdue:
        return {"activation": await MikroTikBillingService.activate(c, f"Pembayaran {p['payment_no']} diterima", "system")}
    return {"activation": "NOT_REQUIRED"}


async def create_payment(body: dict, actor: dict) -> dict:
    inv = await db.invoices.find_one({"id": body["invoice_id"]}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice tidak ditemukan")
    if inv["status"] in ("paid", "cancelled"):
        raise HTTPException(409, f"Invoice sudah {inv['status'].upper()}")
    if await db.payments.find_one({"invoice_id": inv["id"], "status": "pending"}):
        raise HTTPException(409, "Sudah ada pembayaran menunggu konfirmasi untuk invoice ini")
    if body["amount"] < inv["total"]:
        raise HTTPException(400, f"Nominal kurang dari total tagihan ({rupiah(inv['total'])})")
    pay = {"id": uid(), "payment_no": await next_code("PAY"), "invoice_id": inv["id"], "invoice_no": inv["invoice_no"],
           "customer_id": inv["customer_id"], "customer_name": inv["customer_name"], "customer_code": inv["customer_code"],
           "whatsapp": inv.get("whatsapp", ""), "period": inv["period"], "amount": body["amount"], "method": body["method"],
           "reference": body.get("reference", ""), "proof_url": body.get("proof_url", ""), "note": body.get("note", ""),
           "status": "confirmed" if body.get("confirm", True) else "pending", "received_by": actor["email"], "paid_at": now_iso()}
    await db.payments.insert_one(pay)
    pay.pop("_id", None)
    if pay["status"] == "confirmed":
        await finalize_payment(pay, actor)
    return pay


@handler("sync_router")
async def _sync_job(payload: dict):
    router = await db.mikrotik_routers.find_one({"id": payload["router_id"]}, {"_id": 0})
    return await MikroTikCustomerService.sync_router(router, payload.get("actor", "system")) if router else None


async def health_poll_all() -> None:
    for r in await db.mikrotik_routers.find({}, {"_id": 0}).to_list(500):
        await MikroTikConnectionService.health(r)
