from fastapi import APIRouter, Depends, HTTPException

from lib.core import paginate, regex_or, audit
from lib.db import db
from lib.security import require
from models.schemas import (AutomationResult, Invoice, InvoiceGenerateIn, InvoiceGenerateOut, InvoiceUpdate, Paged, Payment, PaymentIn)
from services import billing

router = APIRouter()


@router.get("/invoices", response_model=Paged[Invoice])
async def list_invoices(q: str = "", status: str = "", period: str = "", customer_id: str = "", page: int = 1, limit: int = 20,
                        sort: str = "newest", _: dict = Depends(require("billing.view"))):
    query: dict = {}
    if q:
        query.update(regex_or(q, ["invoice_no", "customer_name", "customer_code", "whatsapp"]))
    for k, v in (("status", status), ("period", period), ("customer_id", customer_id)):
        if v:
            query[k] = v
    s = {"newest": [("created_at", -1)], "due": [("due_date", 1)], "total": [("total", -1)]}.get(sort, [("created_at", -1)])
    return await paginate(db.invoices, query, s, page, limit)


@router.post("/invoices/generate", response_model=InvoiceGenerateOut)
async def generate(body: InvoiceGenerateIn, actor: dict = Depends(require("billing.write"))):
    return await billing.generate_invoices(body.period, actor)


@router.patch("/invoices/{id}", response_model=Invoice)
async def update_invoice(id: str, body: InvoiceUpdate, actor: dict = Depends(require("billing.write"))):
    inv = await db.invoices.find_one({"id": id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice tidak ditemukan")
    if inv["status"] == "paid":
        raise HTTPException(409, "Invoice sudah LUNAS, tidak dapat diubah")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    disc, pen = patch.get("discount", inv["discount"]), patch.get("penalty", inv["penalty"])
    if disc > inv["amount"]:
        raise HTTPException(400, "Diskon melebihi nominal tagihan")
    patch["total"] = inv["amount"] - disc + pen
    res = await db.invoices.find_one_and_update({"id": id}, {"$set": patch}, projection={"_id": 0}, return_document=True)
    await audit(actor, "EDIT_INVOICE", "invoice", id, f"{inv['invoice_no']} {patch}")
    return res


@router.post("/billing/run-automation", response_model=AutomationResult)
async def run_automation(actor: dict = Depends(require("billing.write"))):
    return await billing.run_automation(actor["email"])


@router.get("/payments", response_model=Paged[Payment])
async def list_payments(q: str = "", method: str = "", status: str = "", page: int = 1, limit: int = 20,
                        _: dict = Depends(require("billing.view"))):
    query: dict = {}
    if q:
        query.update(regex_or(q, ["payment_no", "invoice_no", "customer_name", "customer_code", "reference"]))
    if method:
        query["method"] = method
    if status:
        query["status"] = status
    return await paginate(db.payments, query, [("paid_at", -1)], page, limit)


@router.post("/payments", response_model=Payment)
async def create_payment(body: PaymentIn, actor: dict = Depends(require("payments.write"))):
    return await billing.create_payment(body.model_dump(), actor)


@router.post("/payments/{id}/confirm", response_model=Payment)
async def confirm_payment(id: str, actor: dict = Depends(require("payments.write"))):
    p = await db.payments.find_one({"id": id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Pembayaran tidak ditemukan")
    if p["status"] == "confirmed":
        return p  # idempotent
    await db.payments.update_one({"id": id}, {"$set": {"status": "confirmed", "received_by": actor["email"]}})
    p["status"] = "confirmed"
    await billing.finalize_payment(p, actor)
    return p


@router.get("/payments/{id}", response_model=Payment)
async def get_payment(id: str, _: dict = Depends(require("billing.view"))):
    p = await db.payments.find_one({"id": id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Pembayaran tidak ditemukan")
    return p
