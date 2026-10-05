"""Criterion: Fonnte test with invalid/dummy token fails gracefully (backend)."""


def test_fonnte_invalid_token_graceful_failure(superadmin_client):
    c = superadmin_client

    put = c.put(
        "/whatsapp/config",
        json={
            "provider": "fonnte",
            "token": "DUMMY-INVALID-TOKEN-tscheck",
            "country_code": "62",
            "device_label": "tscheck-fonnte-device",
        },
    )
    assert put.status_code == 200, put.text
    assert put.json()["provider"] == "fonnte"

    try:
        resp = c.post("/whatsapp/test", json={"to": "628123456789"})
        # Must not crash: either 200 with success:false, or a handled 4xx/5xx-free response.
        assert resp.status_code == 200, f"expected graceful 200, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body.get("success") is False, f"expected success:false for dummy token, got {body}"
        message = str(body.get("message") or body.get("error") or "")
        assert len(message) > 0, f"expected a non-empty failure message, got {body}"
    finally:
        # Always reset to simulator, even if assertions above fail
        reset = c.put(
            "/whatsapp/config",
            json={"provider": "simulator", "country_code": "62", "device_label": ""},
        )
        assert reset.status_code == 200, reset.text
        assert reset.json()["provider"] == "simulator"
