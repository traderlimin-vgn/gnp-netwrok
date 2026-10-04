"""GenieAcsNbiProvider — real GenieACS Northbound Interface (REST, default port 7557).
Docs: GET /devices?query=&projection=, POST /devices/<id>/tasks?connection_request."""

import json
import math
from urllib.parse import quote

import httpx

from integrations.genieacs.base import AcsError, IGenieAcsProvider

IGD = "InternetGatewayDevice"
PATHS: dict[str, list[str]] = {
    "rx_power": ["VirtualParameters.RXPower", f"{IGD}.WANDevice.1.X_GponInterafceConfig.RXPower",
                 f"{IGD}.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.RXPower", f"{IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
                 f"{IGD}.WANDevice.1.X_CU_WANEPONInterfaceConfig.OpticalTransceiver.RXPower", "Device.Optical.Interface.1.Stats.SignalRxPower"],
    "tx_power": ["VirtualParameters.TXPower", f"{IGD}.WANDevice.1.X_GponInterafceConfig.TXPower",
                 f"{IGD}.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.TXPower", f"{IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower",
                 "Device.Optical.Interface.1.Stats.TransmitOpticalLevel"],
    "temperature": ["VirtualParameters.gettemp", f"{IGD}.WANDevice.1.X_GponInterafceConfig.TransceiverTemperature",
                    f"{IGD}.WANDevice.1.X_ZTE-COM_GponInterfaceConfig.Temperature"],
    "pppoe_username": ["VirtualParameters.pppoeUsername", f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username",
                       f"{IGD}.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username", "Device.PPP.Interface.1.Username"],
    "ip": ["VirtualParameters.pppoeIP", f"{IGD}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress",
           f"{IGD}.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.ExternalIPAddress", "Device.IP.Interface.1.IPv4Address.1.IPAddress"],
    "ssid": [f"{IGD}.LANDevice.1.WLANConfiguration.1.SSID", "Device.WiFi.SSID.1.SSID"],
    "wifi_clients": [f"{IGD}.LANDevice.1.WLANConfiguration.1.TotalAssociations", "Device.WiFi.AccessPoint.1.AssociatedDeviceNumberOfEntries"],
    "software": [f"{IGD}.DeviceInfo.SoftwareVersion", "Device.DeviceInfo.SoftwareVersion"],
    "uptime": [f"{IGD}.DeviceInfo.UpTime", "Device.DeviceInfo.UpTime"],
}
WIFI_SET = {
    IGD: (f"{IGD}.LANDevice.1.WLANConfiguration.1.SSID", f"{IGD}.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase"),
    "Device": ("Device.WiFi.SSID.1.SSID", "Device.WiFi.AccessPoint.1.Security.KeyPassphrase"),
}


def _get(doc: dict, path: str):
    node = doc
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node.get("_value") if isinstance(node, dict) else node


def _first(doc: dict, key: str):
    for p in PATHS[key]:
        v = _get(doc, p)
        if v not in (None, ""):
            return v
    return None


def _dbm(v) -> float | None:
    """Vendors report optical power as dBm, dBm*100, or 0.1 µW units — normalize to dBm."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f < -100:
        return round(f / 100, 2)
    if f > 0 and f > 10:
        return round(10 * math.log10(f * 0.0001), 2)
    return round(f, 2)


def normalize(doc: dict) -> dict:
    did = doc.get("_deviceId", {})
    temp = _first(doc, "temperature")
    return {
        "id": doc["_id"], "serial": did.get("_SerialNumber", ""), "manufacturer": did.get("_Manufacturer", ""),
        "model": did.get("_ProductClass", ""), "software": str(_first(doc, "software") or ""),
        "pppoe_username": str(_first(doc, "pppoe_username") or ""), "ip": str(_first(doc, "ip") or ""),
        "last_inform": doc.get("_lastInform"), "rx_power": _dbm(_first(doc, "rx_power")), "tx_power": _dbm(_first(doc, "tx_power")),
        "temperature": float(temp) if temp not in (None, "") else None, "ssid": str(_first(doc, "ssid") or ""),
        "wifi_clients": int(_first(doc, "wifi_clients") or 0), "uptime": int(_first(doc, "uptime") or 0),
    }


class GenieAcsNbiProvider(IGenieAcsProvider):
    def __init__(self, url: str, username: str = "", password: str = "", timeout: float = 10):
        self.url = url.rstrip("/")
        self.auth = (username, password) if username else None
        self.timeout = timeout

    async def _req(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=self.timeout, auth=self.auth) as c:
                r = await c.request(method, f"{self.url}{path}", **kw)
        except httpx.TimeoutException as e:
            raise AcsError("GENIEACS_TIMEOUT", str(e))
        except httpx.HTTPError as e:
            raise AcsError("GENIEACS_CONNECTION_FAILED", str(e))
        if r.status_code in (401, 403):
            raise AcsError("GENIEACS_AUTH_FAILED")
        if r.status_code == 404:
            raise AcsError("GENIEACS_DEVICE_NOT_FOUND")
        if r.status_code >= 400:
            raise AcsError("GENIEACS_TASK_FAILED", f"HTTP {r.status_code}: {r.text[:200]}")
        return r

    async def test(self) -> int:
        r = await self._req("GET", "/devices/", params={"projection": "_id"})
        return len(r.json())

    async def list_devices(self) -> list[dict]:
        proj = ",".join(["_deviceId", "_lastInform", *[p for ps in PATHS.values() for p in ps]])
        r = await self._req("GET", "/devices/", params={"projection": proj})
        return [normalize(d) for d in r.json()]

    async def _task(self, device_id: str, task: dict) -> str:
        r = await self._req("POST", f"/devices/{quote(device_id, safe='')}/tasks", params={"connection_request": "", "timeout": "3000"}, json=task)
        return "DONE" if r.status_code == 200 else "QUEUED"

    async def set_wifi(self, device_id: str, ssid: str, password: str) -> str:
        q = json.dumps({"_id": device_id})
        r = await self._req("GET", "/devices/", params={"query": q, "projection": f"{IGD}.DeviceInfo.SoftwareVersion,Device.DeviceInfo.SoftwareVersion"})
        docs = r.json()
        if not docs:
            raise AcsError("GENIEACS_DEVICE_NOT_FOUND")
        ssid_path, key_path = WIFI_SET[IGD] if IGD in docs[0] else WIFI_SET["Device"]
        return await self._task(device_id, {"name": "setParameterValues", "parameterValues": [[ssid_path, ssid, "xsd:string"], [key_path, password, "xsd:string"]]})

    async def reboot(self, device_id: str) -> str:
        return await self._task(device_id, {"name": "reboot"})

    async def refresh(self, device_id: str) -> str:
        return await self._task(device_id, {"name": "refreshObject", "objectName": ""})
