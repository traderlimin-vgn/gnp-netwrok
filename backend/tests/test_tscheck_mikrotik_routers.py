"""Criterion: MikroTik Routers — test connection, sync, add router (password never returned)."""
import uuid


def test_test_connection_and_sync_on_seeded_routers(superadmin_client):
    routers = superadmin_client.get("/mikrotik/routers").json()
    assert routers, "no routers seeded"

    online = next((r for r in routers if r.get("status") != "offline"), routers[0])
    r1 = superadmin_client.post(f"/mikrotik/routers/{online['id']}/test")
    assert r1.status_code == 200, r1.text
    tr = r1.json()
    assert "steps" in tr and isinstance(tr["steps"], list) and len(tr["steps"]) > 0
    assert isinstance(tr["success"], bool)

    offline = next((r for r in routers if r.get("status") == "offline"), None)
    if offline:
        r2 = superadmin_client.post(f"/mikrotik/routers/{offline['id']}/test")
        assert r2.status_code == 200, r2.text
        tr2 = r2.json()
        assert tr2["success"] is False
        assert tr2["error_code"], "expected a readable error_code for offline router"

    r3 = superadmin_client.post(f"/mikrotik/routers/{online['id']}/sync")
    assert r3.status_code == 200, r3.text
    sr = r3.json()
    for k in ("synced", "created", "updated", "skipped", "failed"):
        assert k in sr


def test_add_router_password_never_returned(superadmin_client):
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "name": f"tscheck-router-{suffix}",
        "host": "10.10.10.10",
        "username": "gmp-api",
        "password": "SuperSecretPass123",
        "mode": "simulator",
    }
    r = superadmin_client.post("/mikrotik/routers", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "password" not in body
    assert body.get("has_password") is True
    assert payload["password"] not in str(body)

    rid = body["id"]
    cleanup = superadmin_client.delete(f"/mikrotik/routers/{rid}")
    assert cleanup.status_code == 200
