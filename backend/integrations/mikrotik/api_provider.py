"""MikroTikApiProvider — real RouterOS API (8728) / API-SSL (8729) via librouteros.
Runs only on the backend; credentials are decrypted in memory just before connecting."""

import asyncio
import socket
import ssl
import time

from librouteros import connect as ros_connect
from librouteros.exceptions import TrapError, FatalError, ConnectionClosed

from integrations.mikrotik.base import IMikroTikProvider, MikroTikError


class MikroTikApiProvider(IMikroTikProvider):
    _api = None

    def _open(self):
        kw = dict(username=self.cfg.username, password=self.cfg.password, port=self.cfg.port, timeout=self.cfg.timeout)
        if self.cfg.use_ssl:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE  # RouterOS commonly uses self-signed certs; restrict via firewall/VPN
            kw["ssl_wrapper"] = ctx.wrap_socket
        try:
            return ros_connect(host=self.cfg.host, **kw)
        except ssl.SSLError as e:
            raise MikroTikError("MIKROTIK_SSL_ERROR", str(e))
        except (socket.timeout, TimeoutError) as e:
            raise MikroTikError("MIKROTIK_TIMEOUT", str(e))
        except TrapError as e:
            raise MikroTikError("MIKROTIK_AUTH_FAILED", str(e))
        except (OSError, ConnectionClosed, FatalError) as e:
            msg = str(e).lower()
            if "invalid user" in msg or "password" in msg:
                raise MikroTikError("MIKROTIK_AUTH_FAILED", str(e))
            raise MikroTikError("MIKROTIK_CONNECTION_FAILED", str(e))

    async def _run(self, fn):
        def task():
            api = self._open()
            try:
                return fn(api)
            except TrapError as e:
                raise MikroTikError("MIKROTIK_COMMAND_FAILED", str(e))
            finally:
                try:
                    api.close()
                except Exception:
                    pass
        try:
            return await asyncio.wait_for(asyncio.to_thread(task), timeout=self.cfg.timeout + 2)
        except asyncio.TimeoutError:
            raise MikroTikError("MIKROTIK_TIMEOUT")

    async def connect(self) -> None:
        await self._run(lambda api: None)

    async def test_connection(self) -> dict:
        t0 = time.perf_counter()

        def fn(api):
            ident = tuple(api.path("system", "identity"))[0].get("name", "")
            res = tuple(api.path("system", "resource"))[0]
            return ident, res.get("version", "")
        ident, ver = await self._run(fn)
        return {"identity": ident, "version": ver, "response_ms": int((time.perf_counter() - t0) * 1000)}

    async def get_identity(self) -> str:
        return await self._run(lambda api: tuple(api.path("system", "identity"))[0].get("name", ""))

    async def get_routeros_version(self) -> str:
        return (await self.get_system_resource()).get("version", "")

    async def get_system_resource(self) -> dict:
        r = await self._run(lambda api: tuple(api.path("system", "resource"))[0])
        total, free = int(r.get("total-memory", 0) or 0), int(r.get("free-memory", 0) or 0)
        return {"cpu": int(r.get("cpu-load", 0) or 0), "memory_used_pct": round((total - free) / total * 100) if total else 0,
                "uptime": r.get("uptime", ""), "version": r.get("version", ""), "board": r.get("board-name", "")}

    async def _list(self, *path) -> list[dict]:
        return await self._run(lambda api: [dict(x) for x in api.path(*path)])

    async def get_interfaces(self): return await self._list("interface")
    async def get_ppp_secrets(self): return await self._list("ppp", "secret")
    async def get_ppp_active(self): return await self._list("ppp", "active")
    async def get_profiles(self): return await self._list("ppp", "profile")
    async def get_hotspot_users(self): return await self._list("ip", "hotspot", "user")
    async def get_hotspot_active(self): return await self._list("ip", "hotspot", "active")
    async def get_users(self): return await self._list("user")

    async def get_logs(self, limit: int = 50):
        return (await self._list("log"))[-limit:]

    def _find(self, api, name: str, *path):
        for row in api.path(*path):
            if row.get("name") == name:
                return row
        return None

    async def create_pppoe_user(self, name, password, profile, service, comment) -> str:
        def fn(api):
            existing = self._find(api, name, "ppp", "secret")
            if existing:
                return existing[".id"]
            return api.path("ppp", "secret").add(name=name, password=password, profile=profile, service=service, comment=comment)
        return await self._run(fn)

    async def update_pppoe_user(self, name, **fields) -> None:
        def fn(api):
            row = self._find(api, name, "ppp", "secret")
            if not row:
                raise MikroTikError("MIKROTIK_USER_NOT_FOUND", name)
            api.path("ppp", "secret").update(**{".id": row[".id"], **fields})
        await self._run(fn)

    async def _set_disabled(self, name: str, disabled: bool) -> bool:
        def fn(api):
            row = self._find(api, name, "ppp", "secret")
            if not row:
                raise MikroTikError("MIKROTIK_USER_NOT_FOUND", name)
            if bool(row.get("disabled")) == disabled:
                return False  # idempotent: already in desired state
            api.path("ppp", "secret").update(**{".id": row[".id"], "disabled": disabled})
            return True
        return await self._run(fn)

    async def disable_pppoe_user(self, name): return await self._set_disabled(name, True)
    async def enable_pppoe_user(self, name): return await self._set_disabled(name, False)

    async def delete_pppoe_user(self, name) -> None:
        def fn(api):
            row = self._find(api, name, "ppp", "secret")
            if row:
                api.path("ppp", "secret").remove(row[".id"])
        await self._run(fn)

    async def disconnect_pppoe_user(self, name) -> bool:
        def fn(api):
            row = self._find(api, name, "ppp", "active")
            if not row:
                return False
            api.path("ppp", "active").remove(row[".id"])
            return True
        return await self._run(fn)

    async def get_traffic(self, interface=None):
        rows = await self._list("interface")
        return [{"interface": r.get("name"), "rx_bytes": int(r.get("rx-byte", 0) or 0), "tx_bytes": int(r.get("tx-byte", 0) or 0),
                 "running": bool(r.get("running"))} for r in rows if not interface or r.get("name") == interface]
