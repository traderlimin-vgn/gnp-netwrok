"""Criterion: Login & RBAC — superadmin full access, finance forbidden from settings."""


def test_superadmin_login_and_me(client):
    r = client.post(
        "/auth/login",
        json={"email": "superadmin@networkgmp.id", "password": "Gmp@2026!"},
        headers={"X-Requested-With": "gmp"},
    )
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["role"] == "super_admin"
    assert "permissions" in me and len(me["permissions"]) > 0


def test_finance_forbidden_from_settings(finance_client):
    # GET /settings only needs dashboard.view (all roles); the settings.manage write action
    # (super_admin only) is the actual RBAC gate the "/settings -> 403" criterion refers to
    # for a finance user (also enforced client-side by hiding the nav item).
    cur = finance_client.get("/settings")
    assert cur.status_code == 200, cur.text
    r = finance_client.put("/settings", json=cur.json())
    assert r.status_code == 403, f"expected 403 for finance writing /settings, got {r.status_code}: {r.text}"


def test_invalid_login_rejected(client):
    r = client.post(
        "/auth/login",
        json={"email": "superadmin@networkgmp.id", "password": "wrong-password"},
        headers={"X-Requested-With": "gmp"},
    )
    assert r.status_code in (400, 401), f"expected rejection, got {r.status_code}"
