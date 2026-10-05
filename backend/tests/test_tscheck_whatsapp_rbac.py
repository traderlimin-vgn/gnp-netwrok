"""Criterion: RBAC on WhatsApp config endpoints (backend)."""

import httpx


def test_put_config_forbidden_for_finance(finance_client):
    r = finance_client.put(
        "/whatsapp/config",
        json={"provider": "simulator", "country_code": "62", "device_label": ""},
    )
    assert r.status_code == 403, f"expected 403 for finance PUT /whatsapp/config, got {r.status_code}: {r.text}"


def test_put_config_forbidden_for_cs(cs_client):
    r = cs_client.put(
        "/whatsapp/config",
        json={"provider": "simulator", "country_code": "62", "device_label": ""},
    )
    assert r.status_code == 403, f"expected 403 for cs PUT /whatsapp/config, got {r.status_code}: {r.text}"


def test_test_endpoint_forbidden_for_finance(finance_client):
    r = finance_client.post("/whatsapp/test", json={"to": "628123456789"})
    assert r.status_code == 403, f"expected 403 for finance POST /whatsapp/test, got {r.status_code}: {r.text}"


def test_get_config_allowed_for_cs(cs_client):
    r = cs_client.get("/whatsapp/config")
    assert r.status_code == 200, f"expected 200 for cs GET /whatsapp/config, got {r.status_code}: {r.text}"
    assert "provider" in r.json()


def test_get_config_unauthenticated_rejected():
    with httpx.Client(base_url="http://localhost:8001/api", timeout=30.0) as c:
        r = c.get("/whatsapp/config")
        assert r.status_code == 401, f"expected 401 unauthenticated, got {r.status_code}: {r.text}"
