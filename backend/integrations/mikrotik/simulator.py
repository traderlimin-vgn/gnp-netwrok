"""MikroTikSimulatorProvider — RouterOS behaviour backed by Mongo (`sim_ppp`) for demo/testing
when no real router is reachable. Same IMikroTikProvider contract as the API provider."""

import asyncio
import random
from datetime import datetime, timezone

from integrations.mikrotik.base import IMikroTikProvider, MikroTikError
from lib.core import now_iso
from lib.db import db


def _fmt_uptime(seconds: int) -> str:
    d, rem = divmod(max(seconds, 0), 86400)
    h, rem = divmod(rem, 3600)
    m, s = divmod(rem, 60)
    return (f"{d}d" if d else "") + f"{h:02d}h{m:02d}m{s:02d}s"


def _since(iso: str | None) -> int:
    if not iso:
        return 0
    return int((datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds())


class MikroTikSimulatorProvider(IMikroTikProvider):
    async def _guard(self):
        await asyncio.sleep(random.uniform(0.03, 0.12))
        raw = self.cfg.raw
        if raw.get("sim_offline"):
            raise MikroTikError("MIKROTIK_TIMEOUT", f"{self.cfg.host}:{self.cfg.port}")
        if self.cfg.password.startswith("bad") or not self.cfg.password:
            raise MikroTikError("MIKROTIK_AUTH_FAILED", f"user {self.cfg.username}")

    def _q(self, **kw):
        return {"router_id": self.cfg.id, **kw}

    async def test_connection(self) -> dict:
        await self._guard()
        return {"identity": self.cfg.name, "version": self.cfg.raw.get("routeros_version") or "7.14.3",
                "response_ms": random.randint(8, 60)}

    async def get_identity(self):
        await self._guard()
        return self.cfg.name

    async def get_routeros_version(self):
        await self._guard()
        return self.cfg.raw.get("routeros_version") or "7.14.3"

    async def get_system_resource(self):
        await self._guard()
        return {"cpu": random.randint(3, 38), "memory_used_pct": random.randint(28, 64),
                "uptime": _fmt_uptime(_since(self.cfg.raw.get("created_at")) + 86400 * 12),
                "version": self.cfg.raw.get("routeros_version") or "7.14.3", "board": self.cfg.raw.get("board", "RB4011")}

    async def get_interfaces(self):
        await self._guard()
        active = await db.sim_ppp.count_documents(self._q(active=True, disabled=False))
        rows = [{"name": f"ether{i}", "type": "ether", "running": i != 5} for i in range(1, 6)]
        rows.append({"name": "wg-gmp", "type": "wg", "running": True})
        rows.append({"name": "pppoe-server", "type": "pppoe-in", "running": True, "sessions": active})
        return rows

    async def get_ppp_secrets(self):
        await self._guard()
        return await db.sim_ppp.find(self._q(), {"_id": 0}).to_list(5000)

    async def get_ppp_active(self):
        await self._guard()
        rows = await db.sim_ppp.find(self._q(active=True, disabled=False), {"_id": 0}).to_list(5000)
        for r in rows:
            r["uptime"] = _fmt_uptime(_since(r.get("login_at")))
        return rows

    async def get_profiles(self):
        await self._guard()
        pk = await db.packages.find({}, {"_id": 0, "mikrotik_profile": 1}).to_list(200)
        names = sorted({p["mikrotik_profile"] for p in pk if p.get("mikrotik_profile")} | {"default", "ISOLIR"})
        return [{"name": n} for n in names]

    async def get_hotspot_users(self):
        await self._guard()
        return []

    async def get_hotspot_active(self):
        await self._guard()
        return []

    async def get_users(self):
        await self._guard()
        return [{"name": self.cfg.username, "group": "gmp-api"}]

    async def create_pppoe_user(self, name, password, profile, service, comment) -> str:
        await self._guard()
        existing = await db.sim_ppp.find_one(self._q(name=name))
        if existing:
            return existing["id"]
        sid = f"*{random.randint(0x100, 0xFFFF):X}"
        await db.sim_ppp.insert_one(self._q(id=sid, name=name, password=password, profile=profile, service=service or "pppoe",
                                            comment=comment, disabled=False, active=False, address="", caller_id="",
                                            interface="", login_at=None, last_logout=None))
        return sid

    async def _get(self, name):
        row = await db.sim_ppp.find_one(self._q(name=name))
        if not row:
            raise MikroTikError("MIKROTIK_USER_NOT_FOUND", name)
        return row

    async def update_pppoe_user(self, name, **fields):
        await self._guard()
        await self._get(name)
        await db.sim_ppp.update_one(self._q(name=name), {"$set": fields})

    async def disable_pppoe_user(self, name):
        await self._guard()
        row = await self._get(name)
        if row.get("disabled"):
            return False
        await db.sim_ppp.update_one(self._q(name=name), {"$set": {"disabled": True}})
        return True

    async def enable_pppoe_user(self, name):
        await self._guard()
        row = await self._get(name)
        if not row.get("disabled"):
            return False
        await db.sim_ppp.update_one(self._q(name=name), {"$set": {"disabled": False}})
        return True

    async def delete_pppoe_user(self, name):
        await self._guard()
        await db.sim_ppp.delete_one(self._q(name=name))

    async def disconnect_pppoe_user(self, name):
        await self._guard()
        row = await self._get(name)
        if not row.get("active"):
            return False
        # simulate client auto-redial when secret is enabled
        redial = not row.get("disabled")
        await db.sim_ppp.update_one(self._q(name=name), {"$set": {
            "active": redial, "last_logout": now_iso(), "login_at": now_iso() if redial else None}})
        return True

    async def get_traffic(self, interface=None):
        await self._guard()
        rows = await db.sim_ppp.find(self._q(active=True, disabled=False), {"_id": 0, "name": 1}).to_list(5000)
        out = [{"interface": f"<pppoe-{r['name']}>", "rx_bps": random.randint(200_000, 18_000_000),
                "tx_bps": random.randint(100_000, 4_000_000), "running": True} for r in rows]
        return [o for o in out if not interface or o["interface"] == interface]

    async def get_logs(self, limit=50):
        await self._guard()
        rows = await db.mikrotik_actions.find({"router_id": self.cfg.id}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
        return [{"time": r["created_at"], "topics": "ppp,info", "message": f"{r['action']} {r.get('username', '')}"} for r in rows]
