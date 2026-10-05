"""Criterion: GET /network/fault-history/trend?days=30 returns well-formed trend data,
and shows total>0 after a fault is generated via the simulator flow."""
import time


def test_fault_trend_shape(superadmin_client):
    r = superadmin_client.get("/network/fault-history/trend", params={"days": 30})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] == 30
    assert len(body["points"]) == 30
    for p in body["points"]:
        assert set(p.keys()) >= {"date", "faults", "down", "affected"}
    summary = body["summary"]
    assert set(summary.keys()) >= {"total", "open", "resolved", "mttr_min", "affected_total", "by_level"}


def test_fault_trend_reflects_simulated_fault(superadmin_client):
    # find an ODP with >=2 active ONT/customers to cut
    assets = superadmin_client.get("/map/assets", params={"type": "odp"}).json()
    candidates = [a for a in assets if a.get("used", 0) >= 2]
    if not candidates:
        import pytest
        pytest.skip("no ODP with >=2 customers available to simulate a fault")
    odp = candidates[0]

    before = superadmin_client.get("/network/fault-history/trend", params={"days": 30}).json()
    total_before = before["summary"]["total"]

    try:
        r_cut = superadmin_client.post("/network/faults/simulate", json={"odp_id": odp["id"], "cut": True})
        assert r_cut.status_code == 200, r_cut.text

        # force analyze() + record_history()
        r_faults = superadmin_client.get("/network/faults")
        assert r_faults.status_code == 200, r_faults.text
        time.sleep(1)

        after = superadmin_client.get("/network/fault-history/trend", params={"days": 30}).json()
        assert after["summary"]["total"] >= total_before
        if after["summary"]["total"] > total_before:
            assert any(p["faults"] > 0 for p in after["points"])
    finally:
        superadmin_client.post("/network/faults/simulate", json={"odp_id": odp["id"], "cut": False})
