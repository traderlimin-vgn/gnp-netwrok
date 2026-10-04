"""GenieAcsService — config, provider selection, device↔customer mapping and audited TR-069 actions."""

import time
from datetime import datetime, timedelta, timezone

from integrations.genieacs.base import AcsError, IGenieAcsProvider
from integrations.genieacs.nbi_provider import GenieAcsNbiProvider
from integrations.genieacs.simulator import GenieAcsSimulator
from lib.core import audit, now_iso
from lib.db import db
from lib.security import decrypt_secret, encrypt_secret

DEFAULTS = {"enabled": True, "mode": "simulator", "url": "http://127.0.0.1:7557", "username": "", "password_enc": "", "online_minutes": 10}


class GenieAcsService:
    @staticmethod
    async def raw_config() -> dict:
        doc = await db.settings.find_one({"_id": "genieacs"}) or {}
        doc.pop("_id", None)
        return {**DEFAULTS, **doc}

    @classmethod
    async def config_out(cls) -> dict:
        c = await cls.raw_config()
        return {k: v for k, v in c.items() if k != "password_enc"} | {"has_password": bool(c.get("password_enc"))}

    @classmethod
    async def save_config(cls, body: dict, actor: dict) -> dict:
        patch = {k: v for k, v in body.items() if k != "password"}
        patch["url"] = patch["url"].rstrip("/")
        if body.get("password"):
            patch["password_enc"] = encrypt_secret(body["password"])
        await db.settings.update_one({"_id": "genieacs"}, {"$set": patch}, upsert=True)
        await audit(actor, "KONFIGURASI_GENIEACS", "genieacs", "", f"mode={patch['mode']} url={patch['url']}")
        return await cls.config_out()

    @classmethod
    async def provider(cls) -> IGenieAcsProvider:
        c = await cls.raw_config()
        if not c["enabled"]:
            raise AcsError("GENIEACS_DISABLED")
        if c["mode"] == "simulator":
            return GenieAcsSimulator()
        return GenieAcsNbiProvider(c["url"], c["username"], decrypt_secret(c["password_enc"]) if c["password_enc"] else "")

    @classmethod
    async def test(cls, actor: dict) -> dict:
        t0 = time.perf_counter()
        try:
            n = await (await cls.provider()).test()
            res = {"success": True, "message": f"Terhubung ke GenieACS · {n} perangkat terdaftar", "devices": n}
        except AcsError as e:
            res = {"success": False, "message": f"{e.code}: {e.message}", "devices": 0}
        res["response_ms"] = int((time.perf_counter() - t0) * 1000)
        await db.settings.update_one({"_id": "genieacs"}, {"$set": {"last_test": now_iso(), "last_test_ok": res["success"]}}, upsert=True)
        await audit(actor, "TEST_GENIEACS", "genieacs", "", res["message"])
        return res

    @classmethod
    async def devices(cls, q: str = "", status: str = "", customer_id: str = "") -> list[dict]:
        cfg = await cls.raw_config()
        raw = await (await cls.provider()).list_devices()
        links = {l["device_id"]: l["customer_id"] async for l in db.acs_links.find({}, {"_id": 0})}
        custs = await db.customers.find({}, {"_id": 0, "id": 1, "name": 1, "customer_code": 1, "pppoe_username": 1}).to_list(10000)
        by_id = {c["id"]: c for c in custs}
        by_user = {c["pppoe_username"]: c for c in custs if c.get("pppoe_username")}
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=int(cfg.get("online_minutes", 10)))
        out = []
        for d in raw:
            c = by_id.get(links[d["id"]]) if d["id"] in links else by_user.get(d["pppoe_username"])
            li = d.get("last_inform")
            try:
                st = "online" if li and datetime.fromisoformat(str(li).replace("Z", "+00:00")) >= cutoff else ("offline" if li else "unknown")
            except ValueError:
                st = "unknown"
            row = {**d, "status": st, "customer_id": (c or {}).get("id", ""), "customer_name": (c or {}).get("name", ""),
                   "customer_code": (c or {}).get("customer_code", ""), "link_type": "manual" if d["id"] in links else ("auto" if c else "")}
            out.append(row)
        if customer_id:
            out = [d for d in out if d["customer_id"] == customer_id]
        if status:
            out = [d for d in out if d["status"] == status]
        if q:
            ql = q.lower()
            out = [d for d in out if ql in " ".join(str(d.get(k, "")) for k in ("id", "serial", "model", "pppoe_username", "ip", "ssid", "customer_name", "customer_code")).lower()]
        return sorted(out, key=lambda d: (d["status"] != "online", d["customer_name"] or "~"))

    @classmethod
    async def action(cls, device_id: str, action: str, actor: dict, **kw) -> dict:
        p = await cls.provider()
        fn = {"wifi": lambda: p.set_wifi(device_id, kw["ssid"], kw["password"]), "reboot": lambda: p.reboot(device_id), "refresh": lambda: p.refresh(device_id)}[action]
        result = await fn()
        detail = f"{device_id}" + (f" SSID={kw['ssid']}" if action == "wifi" else "")
        await audit(actor, f"GENIEACS_{action.upper()}", "acs_device", device_id, f"{detail} → {result}")
        msgs = {"DONE": "Berhasil dijalankan di perangkat", "QUEUED": "Perangkat tidak merespons connection request — task diantrikan dan dijalankan saat perangkat inform berikutnya"}
        return {"result": result, "message": msgs[result]}

    @staticmethod
    async def link(device_id: str, customer_id: str, actor: dict) -> None:
        if customer_id:
            if not await db.customers.find_one({"id": customer_id}):
                raise AcsError("GENIEACS_DEVICE_NOT_FOUND", "pelanggan tidak ditemukan")
            await db.acs_links.update_one({"device_id": device_id}, {"$set": {"customer_id": customer_id, "updated_at": now_iso()}}, upsert=True)
        else:
            await db.acs_links.delete_one({"device_id": device_id})
        await audit(actor, "GENIEACS_LINK", "acs_device", device_id, f"customer={customer_id or '-'}")
