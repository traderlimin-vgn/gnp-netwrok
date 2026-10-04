"""Criterion: Invoices generate & pay — generate for current period, then pay via /payments."""
import uuid


def _make_customer(client):
    pkg_id = client.get("/packages").json()[0]["id"]
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"tscheck-invpay-{suffix}",
        "whatsapp": "6281234567891",
        "address": "Jl. Test No. 2",
        "package_id": pkg_id,
        "status": "active",
    }
    r = client.post("/customers", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["customer"]["id"]


def test_generate_reports_counts(superadmin_client):
    r = superadmin_client.post("/invoices/generate", json={"period": ""})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "created" in body and "skipped" in body
    assert body["created"] >= 0 and body["skipped"] >= 0


def test_generate_and_pay_invoice(superadmin_client):
    cust_id = _make_customer(superadmin_client)

    gen = superadmin_client.post("/invoices/generate", json={"period": ""})
    assert gen.status_code == 200, gen.text

    invs = superadmin_client.get("/invoices", params={"customer_id": cust_id}).json()
    assert invs["total"] >= 1, f"expected an invoice created for {cust_id}"
    inv = invs["items"][0]
    assert inv["status"] == "unpaid"

    pay = superadmin_client.post("/payments", json={
        "invoice_id": inv["id"], "method": "cash", "amount": inv["total"], "confirm": True,
    })
    assert pay.status_code == 200, pay.text
    payment = pay.json()
    assert payment["payment_no"].startswith("PAY-GMP-")
    assert payment["status"] == "confirmed"

    inv_after = superadmin_client.get("/invoices", params={"customer_id": cust_id}).json()["items"][0]
    assert inv_after["status"] == "paid", inv_after

    pays = superadmin_client.get("/payments", params={"q": payment["payment_no"]}).json()
    assert pays["total"] >= 1
