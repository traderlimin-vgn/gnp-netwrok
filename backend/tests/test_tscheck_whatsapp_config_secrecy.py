"""Criterion: WhatsApp config GET/PUT roundtrip + token secrecy (backend)."""

import json


def test_config_roundtrip_hides_token(superadmin_client):
    c = superadmin_client

    # Baseline: ensure default state is simulator (as seeded) before asserting roundtrip
    base = c.get("/whatsapp/config")
    assert base.status_code == 200, base.text

    # PUT fonnte config with a dummy token
    put = c.put(
        "/whatsapp/config",
        json={
            "provider": "fonnte",
            "token": "DUMMY-TOKEN-tscheck-wa-secrecy",
            "country_code": "62",
            "device_label": "tscheck-device",
        },
    )
    assert put.status_code == 200, put.text
    put_body = put.json()
    assert put_body.get("has_token") is True, put_body
    assert "DUMMY-TOKEN-tscheck-wa-secrecy" not in json.dumps(put_body)

    # GET again — must still report has_token True, never leak the raw token
    get2 = c.get("/whatsapp/config")
    assert get2.status_code == 200, get2.text
    body2 = get2.json()
    assert body2["provider"] == "fonnte"
    assert body2.get("has_token") is True
    raw_text = json.dumps(body2)
    assert "DUMMY-TOKEN-tscheck-wa-secrecy" not in raw_text
    assert "token" not in body2 or body2.get("token") in (None, "")

    # Reset back to simulator to leave the app clean
    reset = c.put(
        "/whatsapp/config",
        json={"provider": "simulator", "country_code": "62", "device_label": ""},
    )
    assert reset.status_code == 200, reset.text
    get3 = c.get("/whatsapp/config")
    assert get3.status_code == 200
    assert get3.json()["provider"] == "simulator"
