"""Criterion: Reports, Audit, Settings — reports JSON, CSV/XLSX export, audit logs, settings save, backup."""


def test_reports_sections_present(superadmin_client):
    r = superadmin_client.get("/reports")
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("finance", "customers", "mikrotik", "technicians"):
        assert key in body


def test_reports_export_csv_and_xlsx(superadmin_client):
    r = superadmin_client.get("/reports/export", params={"kind": "customers", "format": "csv"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert len(r.content) > 0

    r2 = superadmin_client.get("/reports/export", params={"kind": "invoices", "format": "xlsx"})
    assert r2.status_code == 200, r2.text
    assert "spreadsheet" in r2.headers["content-type"]
    assert len(r2.content) > 0


def test_audit_logs_list(superadmin_client):
    r = superadmin_client.get("/audit-logs", params={"limit": 10})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and "total" in body


def test_settings_save_and_backup(superadmin_client):
    cur = superadmin_client.get("/settings").json()
    r = superadmin_client.put("/settings", json=cur)
    assert r.status_code == 200, r.text
    assert r.json()["mikrotik_enabled"] == cur["mikrotik_enabled"]

    before = superadmin_client.get("/backups").json()
    r2 = superadmin_client.post("/backups")
    assert r2.status_code == 200, r2.text
    name = r2.json()["name"]
    after = superadmin_client.get("/backups").json()
    assert any(b["name"] == name for b in after)
    assert len(after) >= len(before)
