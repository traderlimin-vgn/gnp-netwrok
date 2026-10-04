"""Criterion: Auto isolation / activation and MikroTik actions — manual action endpoint + action log."""
import uuid


def _make_customer_with_pppoe(client):
    pkg_id = client.get("/packages").json()[0]["id"]
    router_id = client.get("/mikrotik/routers").json()[0]["id"]
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"tscheck-mkaction-{suffix}",
        "whatsapp": "6281234567892",
        "address": "Jl. Test No. 3",
        "package_id": pkg_id,
        "router_id": router_id,
        "pppoe_username": f"tscheckmk{suffix}",
        "pppoe_password": "Secret123",
        "service": "pppoe",
        "create_pppoe": True,
    }
    r = client.post("/customers", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["customer"]["id"]


def test_isolate_and_activate_action_logged(superadmin_client):
    cust_id = _make_customer_with_pppoe(superadmin_client)

    r = superadmin_client.post(f"/mikrotik/customers/{cust_id}/isolate")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"] in ("SUCCESS", "SKIPPED", "PENDING", "FAILED")

    r2 = superadmin_client.post(f"/mikrotik/customers/{cust_id}/activate")
    assert r2.status_code == 200, r2.text
    assert r2.json()["result"] in ("SUCCESS", "SKIPPED", "PENDING", "FAILED")

    logs2 = superadmin_client.get("/mikrotik/actions", params={"limit": 50}).json()
    matched = [a for a in logs2["items"] if a.get("customer_id") == cust_id]
    assert matched, "expected mikrotik action log entries for this customer"
    assert all(a["result"] in ("SUCCESS", "SKIPPED", "PENDING", "FAILED") for a in matched)


def test_action_rejected_for_invalid_action_name(superadmin_client):
    cust_id = _make_customer_with_pppoe(superadmin_client)
    r = superadmin_client.post(f"/mikrotik/customers/{cust_id}/not-a-real-action")
    assert r.status_code == 404
