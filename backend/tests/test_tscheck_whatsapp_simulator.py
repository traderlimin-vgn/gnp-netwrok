"""Criterion: Simulator WhatsApp test + send still work (backend)."""


def test_simulator_test_and_send(superadmin_client):
    c = superadmin_client

    # Ensure provider is simulator for this test (independent of other test ordering)
    cfg = c.put(
        "/whatsapp/config",
        json={"provider": "simulator", "country_code": "62", "device_label": ""},
    )
    assert cfg.status_code == 200, cfg.text
    assert cfg.json()["provider"] == "simulator"

    test_resp = c.post("/whatsapp/test", json={"to": "628123456789"})
    assert test_resp.status_code == 200, test_resp.text
    test_body = test_resp.json()
    assert test_body.get("success") is True, test_body
    assert test_body.get("provider") == "simulator", test_body

    message_text = "tscheck-wa-sim-send hello"
    send_resp = c.post(
        "/whatsapp/send",
        json={"to": "628123456789", "message": message_text},
    )
    assert send_resp.status_code == 200, send_resp.text
    send_body = send_resp.json()
    assert send_body.get("status") == "sent", send_body
    assert send_body.get("provider") == "simulator", send_body

    messages = c.get("/whatsapp/messages")
    assert messages.status_code == 200, messages.text
    items = messages.json()
    items_list = items.get("items", items) if isinstance(items, dict) else items
    found = any(message_text in str(m) for m in items_list)
    assert found, "sent tscheck message not found in GET /whatsapp/messages"
