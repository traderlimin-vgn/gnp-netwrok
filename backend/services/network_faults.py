"""Network fault localisation: combines GenieACS ONT status with the ODC → ODP → customer topology of the map
to pinpoint the most likely broken cable segment (feeder, distribution, or drop)."""

from integrations.genieacs.service import GenieAcsService
from datetime import datetime

from lib.core import now_iso, uid
from lib.db import db

WEAK_RX = -27.0


async def nearest_odp(lat: float | None, lng: float | None) -> dict | None:
    if lat is None or lng is None:
        return None
    odps = await db.map_assets.find({"type": "odp"}, {"_id": 0}).to_list(5000)
    return min(odps, key=lambda o: (o["latitude"] - lat) ** 2 + (o["longitude"] - lng) ** 2, default=None)


async def record_history(faults: list[dict]) -> None:
    """Open a history row when a segment fault appears, close it (with duration) when it disappears. Idempotent per run."""
    now = now_iso()
    open_rows = {h["fault_key"]: h async for h in db.fault_history.find({"status": "open"}, {"_id": 0})}
    current = {f["id"]: f for f in faults}
    for key, f in current.items():
        if key in open_rows:
            if f["affected_count"] > open_rows[key].get("affected_max", 0):
                await db.fault_history.update_one({"id": open_rows[key]["id"]}, {"$set": {"affected_max": f["affected_count"]}})
            continue
        await db.fault_history.insert_one({"id": uid(), "fault_key": key, "level": f["level"], "severity": f["severity"], "title": f["title"],
                                           "segment": f["segment"], "latitude": f["latitude"], "longitude": f["longitude"], "odp_id": f["odp_id"],
                                           "odc_id": f["odc_id"], "affected_max": f["affected_count"], "status": "open", "started_at": now,
                                           "resolved_at": None, "duration_min": 0})
    for key, h in open_rows.items():
        if key not in current:
            mins = int((datetime.fromisoformat(now) - datetime.fromisoformat(h["started_at"])).total_seconds() // 60)
            await db.fault_history.update_one({"id": h["id"]}, {"$set": {"status": "resolved", "resolved_at": now, "duration_min": mins}})


async def analyze() -> dict:
    assets = await db.map_assets.find({}, {"_id": 0}).to_list(5000)
    odcs = {a["id"]: a for a in assets if a["type"] == "odc"}
    odps = {a["id"]: a for a in assets if a["type"] == "odp"}
    custs = await db.customers.find({"status": {"$ne": "stopped"}}, {"_id": 0, "id": 1, "name": 1, "customer_code": 1, "odp_id": 1,
                                                                    "latitude": 1, "longitude": 1, "address": 1}).to_list(10000)
    devices = await GenieAcsService.devices()
    by_cust = {d["customer_id"]: d for d in devices if d["customer_id"]}

    ont: dict[str, dict] = {}
    for c in custs:
        d = by_cust.get(c["id"])
        if not d:
            continue
        st = "online" if d["status"] == "online" else "offline"
        if st == "online" and d["rx_power"] is not None and d["rx_power"] < WEAK_RX:
            st = "weak"
        ont[c["id"]] = {"customer_id": c["id"], "customer_name": c["name"], "customer_code": c["customer_code"], "ont_status": st,
                        "rx_power": d["rx_power"], "serial": d["serial"]}

    odp_rows, faults = [], []
    for oid, o in odps.items():
        members = [ont[c["id"]] for c in custs if c.get("odp_id") == oid and c["id"] in ont]
        total = len(members)
        off = [m for m in members if m["ont_status"] == "offline"]
        weak = [m for m in members if m["ont_status"] == "weak"]
        sev = "ok"
        if total >= 2 and len(off) / total >= 0.6:
            sev = "down"
        elif total and (len(off) / total >= 0.3 or len(weak) >= 2):
            sev = "warning"
        odc = odcs.get(o.get("parent_id", ""), {})
        odp_rows.append({"odp_id": oid, "odp_name": o["name"], "odc_id": odc.get("id", ""), "odc_name": odc.get("name", ""),
                         "latitude": o["latitude"], "longitude": o["longitude"], "total": total, "online": total - len(off) - len(weak),
                         "offline": len(off), "weak": len(weak), "severity": sev})
        if sev == "down":
            faults.append({"id": f"odp-{oid}", "level": "odp", "severity": "down", "odp_id": oid, "odc_id": odc.get("id", ""),
                           "title": f"Dugaan putus kabel distribusi {odc.get('name', 'ODC')} → {o['name']}",
                           "segment": f"{odc.get('name', '-')} → {o['name']}", "latitude": o["latitude"], "longitude": o["longitude"],
                           "affected": off, "message": f"{len(off)}/{total} ONT di {o['name']} LOS/offline bersamaan"})
        elif sev == "warning" and weak and not off:
            faults.append({"id": f"odp-weak-{oid}", "level": "odp", "severity": "warning", "odp_id": oid, "odc_id": odc.get("id", ""),
                           "title": f"Redaman tinggi di {o['name']}", "segment": f"{odc.get('name', '-')} → {o['name']}",
                           "latitude": o["latitude"], "longitude": o["longitude"], "affected": weak,
                           "message": f"{len(weak)} ONT RX < {WEAK_RX} dBm — cek konektor/splitter/tekukan kabel"})
        if sev != "down":
            for m in off:
                c = next(x for x in custs if x["id"] == m["customer_id"])
                faults.append({"id": f"drop-{m['customer_id']}", "level": "drop", "severity": "warning", "odp_id": oid, "odc_id": odc.get("id", ""),
                               "title": f"Kabel drop / ONT {m['customer_name']} offline", "segment": f"{o['name']} → {m['customer_code']}",
                               "latitude": c.get("latitude") or o["latitude"], "longitude": c.get("longitude") or o["longitude"], "affected": [m],
                               "message": "ONT lain di ODP yang sama normal — kemungkinan kabel drop, adaptor ONT, atau listrik pelanggan"})

    odc_rows = []
    for cid, c in odcs.items():
        rows = [r for r in odp_rows if r["odc_id"] == cid and r["total"]]
        down = [r for r in rows if r["severity"] == "down"]
        sev = "down" if len(down) >= 2 and len(down) / max(len(rows), 1) >= 0.5 else ("warning" if down else "ok")
        odc_rows.append({"odc_id": cid, "odc_name": c["name"], "latitude": c["latitude"], "longitude": c["longitude"],
                         "odps_total": len(rows), "odps_down": len(down), "severity": sev})
        if sev == "down":
            affected = [m for r in down for f in faults if f["id"] == f"odp-{r['odp_id']}" for m in f["affected"]]
            faults = [f for f in faults if not (f["level"] == "odp" and f["odc_id"] == cid and f["severity"] == "down")]
            faults.append({"id": f"odc-{cid}", "level": "odc", "severity": "down", "odp_id": "", "odc_id": cid,
                           "title": f"Dugaan putus kabel feeder → {c['name']}", "segment": f"OLT/POP → {c['name']}",
                           "latitude": c["latitude"], "longitude": c["longitude"], "affected": affected,
                           "message": f"{len(down)}/{len(rows)} ODP di bawah {c['name']} down bersamaan"})

    rank = {"odc": 0, "odp": 1, "drop": 2}
    faults.sort(key=lambda f: (f["severity"] != "down", rank[f["level"]], -len(f["affected"])))
    for f in faults:
        f["affected_count"] = len(f["affected"])
    await record_history(faults)
    return {"generated_at": now_iso(), "faults": faults, "odps": odp_rows, "odcs": odc_rows, "onts": list(ont.values())}
