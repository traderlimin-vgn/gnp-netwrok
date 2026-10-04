"""Criterion: PPPoE monitoring — /mikrotik/pppoe lists sessions, filters by router_id/status/q work."""


def test_pppoe_list_and_filters(superadmin_client):
    r = superadmin_client.get("/mikrotik/pppoe")
    assert r.status_code == 200, r.text
    sessions = r.json()
    assert isinstance(sessions, list)

    routers = superadmin_client.get("/mikrotik/routers").json()
    assert routers
    rid = routers[0]["id"]
    r2 = superadmin_client.get("/mikrotik/pppoe", params={"router_id": rid})
    assert r2.status_code == 200
    for s in r2.json():
        assert s["router_id"] == rid

    r3 = superadmin_client.get("/mikrotik/pppoe", params={"status": "online"})
    assert r3.status_code == 200
    for s in r3.json():
        assert s["status"] == "online"
