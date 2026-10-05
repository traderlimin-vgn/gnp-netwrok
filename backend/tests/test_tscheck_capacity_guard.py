"""Criteria: capacity guard on customer<->ODP assignment (409) and asset capacity lowering (422)."""
import uuid


def _get_package_and_router(client):
    pkgs = client.get("/packages").json()
    assert pkgs, "no packages seeded"
    routers = client.get("/mikrotik/routers").json()
    online = [r for r in routers if r.get("status") != "offline"] or routers
    assert online, "no routers seeded"
    return pkgs[0]["id"], online[0]["id"]


def _make_customer_payload(pkg_id, router_id, suffix, odp_id):
    return {
        "name": f"tscheck-capcust-{suffix}",
        "whatsapp": "6281234567890",
        "address": "Jl. Test Kapasitas No. 1",
        "package_id": pkg_id,
        "router_id": router_id,
        "service": "pppoe",
        "create_pppoe": False,
        "odp_id": odp_id,
    }


def test_odp_full_rejects_second_customer(superadmin_client):
    pkg_id, router_id = _get_package_and_router(superadmin_client)
    suffix = uuid.uuid4().hex[:8]

    # Create a fresh ODP with capacity=1 so we fully control usage.
    r = superadmin_client.post("/map/assets", json={
        "type": "odp", "name": f"tscheck-ODP-{suffix}", "capacity": 1,
        "latitude": -6.2, "longitude": 106.8, "parent_id": "",
    })
    assert r.status_code == 200, r.text
    odp = r.json()
    odp_id = odp["id"]

    # First customer -> OK (1/1 used)
    p1 = _make_customer_payload(pkg_id, router_id, suffix + "a", odp_id)
    r1 = superadmin_client.post("/customers", json=p1)
    assert r1.status_code == 200, r1.text
    cust1_id = r1.json()["customer"]["id"]

    # Second customer -> 409 ODP penuh
    p2 = _make_customer_payload(pkg_id, router_id, suffix + "b", odp_id)
    r2 = superadmin_client.post("/customers", json=p2)
    assert r2.status_code == 409, r2.text
    assert "penuh" in r2.json()["detail"].lower()

    # Assigning to a free-port ODP (seeded ODP-GMP-01, 2/16) should succeed.
    assets = superadmin_client.get("/map/assets", params={"type": "odp"}).json()
    free_odp = next(a for a in assets if a["name"] == "ODP-GMP-01")
    assert free_odp["used"] < free_odp["capacity"]
    p3 = _make_customer_payload(pkg_id, router_id, suffix + "c", free_odp["id"])
    r3 = superadmin_client.post("/customers", json=p3)
    assert r3.status_code == 200, r3.text

    # cleanup
    superadmin_client.delete(f"/customers/{cust1_id}")
    superadmin_client.delete(f"/customers/{r3.json()['customer']['id']}")
    superadmin_client.delete(f"/map/assets/{odp_id}")


def test_lower_capacity_below_used_rejected(superadmin_client):
    pkg_id, router_id = _get_package_and_router(superadmin_client)
    suffix = uuid.uuid4().hex[:8]

    r = superadmin_client.post("/map/assets", json={
        "type": "odp", "name": f"tscheck-ODP2-{suffix}", "capacity": 2,
        "latitude": -6.21, "longitude": 106.81, "parent_id": "",
    })
    assert r.status_code == 200, r.text
    odp = r.json()
    odp_id = odp["id"]

    p1 = _make_customer_payload(pkg_id, router_id, suffix + "x", odp_id)
    r1 = superadmin_client.post("/customers", json=p1)
    assert r1.status_code == 200, r1.text
    cust1_id = r1.json()["customer"]["id"]

    p2 = _make_customer_payload(pkg_id, router_id, suffix + "y", odp_id)
    r2 = superadmin_client.post("/customers", json=p2)
    assert r2.status_code == 200, r2.text
    cust2_id = r2.json()["customer"]["id"]

    # Lower capacity below used (2) -> 422
    r3 = superadmin_client.put(f"/map/assets/{odp_id}", json={
        "type": "odp", "name": odp["name"], "capacity": 1,
        "latitude": -6.21, "longitude": 106.81, "parent_id": "",
    })
    assert r3.status_code == 422, r3.text
    assert "di bawah" in r3.json()["detail"].lower()

    # Setting capacity >= used succeeds
    r4 = superadmin_client.put(f"/map/assets/{odp_id}", json={
        "type": "odp", "name": odp["name"], "capacity": 2,
        "latitude": -6.21, "longitude": 106.81, "parent_id": "",
    })
    assert r4.status_code == 200, r4.text

    # cleanup
    superadmin_client.delete(f"/customers/{cust1_id}")
    superadmin_client.delete(f"/customers/{cust2_id}")
    superadmin_client.delete(f"/map/assets/{odp_id}")
