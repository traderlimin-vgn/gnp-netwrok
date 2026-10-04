"""GenieAcsSimulator — demo ACS backed by Mongo (acs_sim_devices) so the UI works without a real GenieACS server."""

import random
from datetime import datetime, timedelta, timezone

from integrations.genieacs.base import AcsError, IGenieAcsProvider
from lib.db import db

MODELS = [("ZTE", "F609", "V6.0.10P3N12"), ("HUAWEI", "HG8245H5", "V3R017C10S115"), ("FiberHome", "HG6243C", "RP2930"), ("ZTE", "F670L", "V9.0.10P1N12")]


def _ago(seconds: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


class GenieAcsSimulator(IGenieAcsProvider):
    async def _ensure(self) -> None:
        if await db.acs_sim_devices.count_documents({}):
            return
        rnd = random.Random(7)
        custs = await db.customers.find({"pppoe_username": {"$ne": ""}}, {"_id": 0, "pppoe_username": 1, "ip_address": 1}).to_list(5000)
        docs = []
        for i, c in enumerate(custs + [{"pppoe_username": ""}, {"pppoe_username": ""}]):
            man, model, sw = MODELS[i % len(MODELS)]
            oui = {"ZTE": "D0608C", "HUAWEI": "00259E", "FiberHome": "C85A9F"}[man]
            serial = f"{man[:4].upper()}{rnd.randint(0x10000000, 0xFFFFFFFF):08X}"
            docs.append({"id": f"{oui}-{model}-{serial}", "serial": serial, "manufacturer": man, "model": model, "software": sw,
                         "pppoe_username": c["pppoe_username"], "ip": c.get("ip_address", ""), "rx_power": round(rnd.uniform(-28.8, -17.5), 2),
                         "tx_power": round(rnd.uniform(1.8, 2.9), 2), "temperature": round(rnd.uniform(38, 56), 1),
                         "ssid": f"GMP-{(c['pppoe_username'] or serial[-4:]).upper()}", "wifi_clients": rnd.randint(0, 9),
                         "uptime": rnd.randint(3600, 2_000_000), "sim_offline": rnd.random() < 0.12, "boot_at": None})
        if docs:
            await db.acs_sim_devices.insert_many(docs)

    async def test(self) -> int:
        await self._ensure()
        return await db.acs_sim_devices.count_documents({})

    async def list_devices(self) -> list[dict]:
        await self._ensure()
        out = []
        async for d in db.acs_sim_devices.find({}, {"_id": 0}):
            offline = d.pop("sim_offline", False)
            d.pop("boot_at", None)
            d["last_inform"] = _ago(random.randint(4 * 3600, 3 * 86400) if offline else random.randint(5, 240))
            if d["rx_power"] is not None:
                d["rx_power"] = round(d["rx_power"] + random.uniform(-0.15, 0.15), 2)
            if offline:
                d["wifi_clients"] = 0
            out.append(d)
        return out

    async def _get(self, device_id: str) -> dict:
        d = await db.acs_sim_devices.find_one({"id": device_id}, {"_id": 0})
        if not d:
            raise AcsError("GENIEACS_DEVICE_NOT_FOUND")
        return d

    async def set_wifi(self, device_id: str, ssid: str, password: str) -> str:
        d = await self._get(device_id)
        await db.acs_sim_devices.update_one({"id": device_id}, {"$set": {"ssid": ssid}})
        return "QUEUED" if d.get("sim_offline") else "DONE"

    async def reboot(self, device_id: str) -> str:
        d = await self._get(device_id)
        if d.get("sim_offline"):
            return "QUEUED"
        await db.acs_sim_devices.update_one({"id": device_id}, {"$set": {"uptime": 0, "wifi_clients": 0}})
        return "DONE"

    async def refresh(self, device_id: str) -> str:
        d = await self._get(device_id)
        return "QUEUED" if d.get("sim_offline") else "DONE"
