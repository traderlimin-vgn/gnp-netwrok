"""Criterion: Customer CRUD with Create PPPoE on MikroTik."""
import uuid


def _get_package_and_router(client):
    pkgs = client.get("/packages").json()
    assert pkgs, "no packages seeded"
    routers = client.get("/mikrotik/routers").json()
    online = [r for r in routers if r.get("status") != "offline"] or routers
    assert online, "no routers seeded"
    return pkgs[0]["id"], online[0]["id"]


def test_create_customer_with_pppoe(superadmin_client):
    pkg_id, router_id = _get_package_and_router(superadmin_client)
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"tscheck-customer-{suffix}",
        "whatsapp": "6281234567890",
        "address": "Jl. Test No. 1",
        "package_id": pkg_id,
        "router_id": router_id,
        "pppoe_username": f"tscheck{suffix}",
        "pppoe_password": "Secret123",
        "service": "pppoe",
        "create_pppoe": True,
    }
    r = superadmin_client.post("/customers", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    cust = body["customer"]
    assert cust["name"] == payload["name"]
    assert cust["integration_status"] in ("OK", "MIKROTIK_SYNC_FAILED", "MIKROTIK_OFFLINE", "PENDING")
    assert body["mikrotik_result"]

    cust_id = cust["id"]

    # edit
    r2 = superadmin_client.put(f"/customers/{cust_id}", json={**payload, "name": f"tscheck-customer-{suffix}-edited"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["customer"]["name"].endswith("-edited")

    # delete
    r3 = superadmin_client.delete(f"/customers/{cust_id}")
    assert r3.status_code == 200, r3.text

    # confirm gone
    r4 = superadmin_client.get(f"/customers/{cust_id}")
    assert r4.status_code == 404
