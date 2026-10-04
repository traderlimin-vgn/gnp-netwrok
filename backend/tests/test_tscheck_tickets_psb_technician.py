"""Criterion: Tickets, PSB, Technician — create ticket (TKT-GMP-...), create PSB (PSB-GMP-...),
WhatsApp log, technician dashboard Terima -> Selesai."""
import uuid


def _make_customer(client):
    pkg_id = client.get("/packages").json()[0]["id"]
    suffix = uuid.uuid4().hex[:8]
    r = client.post("/customers", json={
        "name": f"tscheck-ticket-cust-{suffix}", "whatsapp": "6281234567893",
        "address": "Jl. Test No. 4", "package_id": pkg_id,
    })
    assert r.status_code == 200, r.text
    return r.json()["customer"]["id"]


def test_create_ticket_and_technician_flow(superadmin_client, teknisi_client):
    cust_id = _make_customer(superadmin_client)
    techs = superadmin_client.get("/technicians").json()
    assert techs, "no technicians seeded"
    tech = next((t for t in techs if t["email"] == "teknisi1@networkgmp.id"), techs[0])

    r = superadmin_client.post("/tickets", json={
        "customer_id": cust_id, "complaint": "tscheck: koneksi putus", "priority": "medium",
        "technician_id": tech["id"],
    })
    assert r.status_code == 200, r.text
    ticket = r.json()
    assert ticket["ticket_no"].startswith("TKT-GMP-")
    tid = ticket["id"]

    # technician accepts (Terima -> assigned/in_progress) then resolves
    upd = superadmin_client.patch(f"/tickets/{tid}", json={"status": "in_progress"})
    assert upd.status_code == 200, upd.text
    upd2 = superadmin_client.patch(f"/tickets/{tid}", json={"status": "resolved"})
    assert upd2.status_code == 200, upd2.text
    assert upd2.json()["status"] == "resolved"


def test_create_psb(superadmin_client):
    pkg_id = superadmin_client.get("/packages").json()[0]["id"]
    suffix = uuid.uuid4().hex[:8]
    r = superadmin_client.post("/psb", json={
        "name": f"tscheck-psb-{suffix}", "whatsapp": "6281234567894",
        "address": "Jl. Test No. 5", "package_id": pkg_id,
    })
    assert r.status_code == 200, r.text
    psb = r.json()
    assert psb["psb_no"].startswith("PSB-GMP-")


def test_whatsapp_log_has_messages(superadmin_client):
    r = superadmin_client.get("/whatsapp/messages", params={"limit": 5})
    assert r.status_code == 200, r.text
    assert "items" in r.json()
