"""MikroTik integration services — the only code that talks to routers.
MikroTikConnectionService: provider selection, retry + exponential backoff, health, test.
MikroTikCustomerService:   PPPoE secret lifecycle + sync.
MikroTikBillingService:    idempotent isolation/activation, fail-safe pending queue."""

import asyncio
import os
import time

from integrations.mikrotik.base import IMikroTikProvider, MikroTikError, RouterConfig, ERROR_MESSAGES
from integrations.mikrotik.api_provider import MikroTikApiProvider
from integrations.mikrotik.simulator import MikroTikSimulatorProvider
from integrations.whatsapp.service import WhatsAppService
from lib.core import uid, now_iso, notify, audit
from lib.db import db
from lib.security import decrypt_secret
from lib.settings import get_settings

RETRYABLE = {"MIKROTIK_TIMEOUT", "MIKROTIK_CONNECTION_FAILED"}


async def log_action(router: dict | None, action: str, result: str, actor: str = "system", username: str = "",
                     customer: dict | None = None, reason: str = "", error_code: str = "", message: str = "") -> None:
    await db.mikrotik_actions.insert_one({
        "id": uid(), "created_at": now_iso(), "actor": actor,
        "router_id": (router or {}).get("id", ""), "router_name": (router or {}).get("name", "-"),
        "action": action, "username": username, "customer_id": (customer or {}).get("id", ""),
        "customer_name": (customer or {}).get("name", ""), "reason": reason, "result": result,
        "error_code": error_code, "message": message,
    })


class MikroTikConnectionService:
    @staticmethod
    def provider(router: dict, settings: dict) -> IMikroTikProvider:
        cfg = RouterConfig(
            id=router["id"], name=router["name"], host=router["host"],
            port=int(router.get("api_port") or 8728), username=router.get("username", ""),
            password=decrypt_secret(router.get("password_enc", "")),
            timeout=settings.get("timeout_ms", int(os.environ.get("MIKROTIK_API_TIMEOUT", 10000))) / 1000, raw=router,
        )
        return MikroTikSimulatorProvider(cfg) if router.get("mode") == "simulator" else MikroTikApiProvider(cfg)

    @classmethod
    async def call(cls, router: dict, method: str, *args, **kwargs):
        s = await get_settings()
        if not s["mikrotik_enabled"]:
            raise MikroTikError("MIKROTIK_DISABLED")
        p = cls.provider(router, s)
        attempts = max(1, int(s["retry_count"]))
        last: MikroTikError | None = None
        for i in range(attempts):
            try:
                result = await getattr(p, method)(*args, **kwargs)
                if router.get("status") != "online":
                    await notify("mikrotik_online", "MikroTik kembali online", f"Router {router['name']} terhubung kembali")
                    asyncio.create_task(MikroTikBillingService.retry_pending(router["id"]))
                await db.mikrotik_routers.update_one({"id": router["id"]}, {"$set": {
                    "status": "online", "last_connected": now_iso(), "last_error": ""}})
                router["status"] = "online"
                return result
            except MikroTikError as e:
                last = e
                if e.code not in RETRYABLE:
                    raise
                if i < attempts - 1:
                    await asyncio.sleep(0.4 * (2 ** i))  # exponential backoff
        assert last is not None
        if router.get("status") != "offline":
            await notify("mikrotik_offline", "MikroTik offline", f"Router {router['name']}: {last.message}")
        await db.mikrotik_routers.update_one({"id": router["id"]}, {"$set": {
            "status": "offline", "last_error": f"{last.code}: {last.message}"}})
        router["status"] = "offline"
        raise last

    @classmethod
    async def test(cls, router: dict, actor: str) -> dict:
        steps = [
            {"key": "connect", "label": "Terhubung ke MikroTik API", "ok": False, "detail": ""},
            {"key": "auth", "label": "Autentikasi berhasil", "ok": False, "detail": ""},
            {"key": "identity", "label": "Router Identity terdeteksi", "ok": False, "detail": ""},
            {"key": "version", "label": "Versi RouterOS terdeteksi", "ok": False, "detail": ""},
        ]
        try:
            t0 = time.perf_counter()
            info = await cls.call(router, "test_connection")
            ms = info.get("response_ms") or int((time.perf_counter() - t0) * 1000)
            for st in steps:
                st["ok"] = True
            steps[0]["detail"] = f"{router['host']}:{router.get('api_port', 8728)} (API)"
            steps[1]["detail"] = f"user {router.get('username')}"
            steps[2]["detail"] = info["identity"]
            steps[3]["detail"] = info["version"]
            await db.mikrotik_routers.update_one({"id": router["id"]}, {"$set": {
                "identity": info["identity"], "routeros_version": info["version"], "response_ms": ms, "last_test_ok": True}})
            await log_action(router, "TEST_CONNECTION", "SUCCESS", actor, message=f"{info['identity']} RouterOS {info['version']} ({ms} ms)")
            return {"success": True, "steps": steps, "error_code": "", "message": "Koneksi berhasil",
                    "identity": info["identity"], "version": info["version"], "response_ms": ms}
        except MikroTikError as e:
            if e.code == "MIKROTIK_AUTH_FAILED":
                steps[0]["ok"] = True
                steps[1]["detail"] = e.message
            else:
                steps[0]["detail"] = e.message
            await db.mikrotik_routers.update_one({"id": router["id"]}, {"$set": {"last_test_ok": False}})
            await log_action(router, "TEST_CONNECTION", "FAILED", actor, error_code=e.code, message=e.message)
            return {"success": False, "steps": steps, "error_code": e.code, "message": e.message,
                    "identity": "", "version": "", "response_ms": 0}

    @classmethod
    async def health(cls, router: dict) -> dict:
        t0 = time.perf_counter()
        try:
            res = await cls.call(router, "get_system_resource")
            patch = {"cpu": res["cpu"], "memory_used_pct": res["memory_used_pct"], "uptime": res["uptime"],
                     "routeros_version": res.get("version") or router.get("routeros_version", ""),
                     "response_ms": int((time.perf_counter() - t0) * 1000)}
            await db.mikrotik_routers.update_one({"id": router["id"]}, {"$set": patch})
            return {**router, **patch, "status": "online"}
        except MikroTikError as e:
            return {**router, "status": "offline", "last_error": f"{e.code}: {e.message}"}


class MikroTikBillingService:
    @staticmethod
    async def _router_for(customer: dict) -> dict | None:
        if not customer.get("router_id") or not customer.get("pppoe_username"):
            return None
        return await db.mikrotik_routers.find_one({"id": customer["router_id"]}, {"_id": 0})

    @classmethod
    async def execute(cls, customer: dict, ops: list[tuple[str, str, tuple]], actor: str, reason: str,
                      queue_on_fail: bool = True) -> str:
        """ops: [(ACTION_LABEL, provider_method, args)]. Returns SUCCESS / PENDING / FAILED / SKIPPED."""
        router = await cls._router_for(customer)
        if not router:
            return "SKIPPED"
        s = await get_settings()
        if not s["mikrotik_enabled"]:
            await log_action(router, ops[0][0], "SKIPPED", actor, customer["pppoe_username"], customer, reason, "MIKROTIK_DISABLED", ERROR_MESSAGES["MIKROTIK_DISABLED"])
            return "SKIPPED"
        for i, (label, method, args) in enumerate(ops):
            try:
                changed = await MikroTikConnectionService.call(router, method, customer["pppoe_username"], *args)
                msg = "" if changed is not False else "Tidak ada perubahan (state sudah sesuai)"
                await log_action(router, label, "SUCCESS", actor, customer["pppoe_username"], customer, reason, message=msg)
            except MikroTikError as e:
                if e.code in RETRYABLE and queue_on_fail:
                    await db.mikrotik_pending.insert_one({
                        "id": uid(), "router_id": router["id"], "router_name": router["name"], "customer_id": customer["id"],
                        "customer_name": customer["name"], "username": customer["pppoe_username"],
                        "ops": [list(o) for o in ops[i:]], "reason": reason, "attempts": 0, "status": "pending",
                        "last_error": e.code, "created_at": now_iso()})
                    await log_action(router, label, "PENDING", actor, customer["pppoe_username"], customer, reason, "MIKROTIK_ROUTER_OFFLINE", ERROR_MESSAGES["MIKROTIK_ROUTER_OFFLINE"])
                    await db.customers.update_one({"id": customer["id"]}, {"$set": {"integration_status": "MIKROTIK_OFFLINE"}})
                    return "PENDING"
                await log_action(router, label, "FAILED", actor, customer["pppoe_username"], customer, reason, e.code, e.message)
                await db.customers.update_one({"id": customer["id"]}, {"$set": {"integration_status": "MIKROTIK_SYNC_FAILED", "integration_error": e.message}})
                return "FAILED"
        await db.customers.update_one({"id": customer["id"]}, {"$set": {"integration_status": "OK", "integration_error": ""}})
        return "SUCCESS"

    @classmethod
    async def isolate(cls, customer: dict, reason: str, actor: str = "system") -> str:
        if customer.get("status") == "isolir" and customer.get("mikrotik_disabled"):
            return "SKIPPED"  # idempotent
        s = await get_settings()
        await db.customers.update_one({"id": customer["id"]}, {"$set": {"status": "isolir", "isolated_at": now_iso()}})
        ops: list[tuple[str, str, tuple]] = []
        methods = s["isolation_methods"]
        if "disable_secret" in methods:
            ops.append(("DISABLE_USER", "disable_pppoe_user", ()))
        if "change_profile" in methods:
            ops.append(("UPDATE_PROFILE", "update_pppoe_user", ()))
        if "disconnect" in methods:
            ops.append(("DISCONNECT_USER", "disconnect_pppoe_user", ()))
        ops = [(l, m, a) if m != "update_pppoe_user" else (l, "set_profile", (s["isolation_profile"],)) for l, m, a in ops]
        result = await cls.execute(customer, ops, actor, reason) if ops else "SKIPPED"
        if result == "SUCCESS":
            await db.customers.update_one({"id": customer["id"]}, {"$set": {"mikrotik_disabled": True, "connection_status": "offline", "last_offline": now_iso()}})
        await audit({"email": actor, "role": "system" if actor == "system" else "user"}, "ISOLIR", "customer", customer["id"], f"{customer['name']}: {reason} → MikroTik {result}")
        await notify("isolated", "Pelanggan diisolir", f"{customer['name']} ({customer.get('customer_code')}) — {reason}")
        await WhatsAppService.send_template("isolation", customer.get("whatsapp", ""), customer["name"], {"nama": customer["name"]})
        return result

    @classmethod
    async def activate(cls, customer: dict, reason: str, actor: str = "system") -> str:
        if customer.get("status") != "isolir":
            return "SKIPPED"  # never touch MikroTik when the customer wasn't isolated
        s = await get_settings()
        await db.customers.update_one({"id": customer["id"]}, {"$set": {"status": "active"}})
        result = "SKIPPED"
        if s["auto_activation"] or actor != "system":
            pkg = await db.packages.find_one({"id": customer.get("package_id")}) or {}
            ops: list[tuple[str, str, tuple]] = [("ENABLE_USER", "enable_pppoe_user", ())]
            if "change_profile" in s["isolation_methods"] and pkg.get("mikrotik_profile"):
                ops.append(("UPDATE_PROFILE", "set_profile", (pkg["mikrotik_profile"],)))
            ops.append(("DISCONNECT_USER", "disconnect_pppoe_user", ()))
            result = await cls.execute(customer, ops, actor, reason)
            if result == "SUCCESS":
                await db.customers.update_one({"id": customer["id"]}, {"$set": {"mikrotik_disabled": False, "connection_status": "online", "last_online": now_iso()}})
        else:
            router = await cls._router_for(customer)
            if router:
                await log_action(router, "ENABLE_USER", "SKIPPED", actor, customer["pppoe_username"], customer, reason, message="Auto Activation OFF — aktifkan manual")
        await audit({"email": actor, "role": "system" if actor == "system" else "user"}, "AKTIVASI", "customer", customer["id"], f"{customer['name']}: {reason} → MikroTik {result}")
        await notify("activated", "Pelanggan aktif kembali", f"{customer['name']} ({customer.get('customer_code')})")
        await WhatsAppService.send_template("activation", customer.get("whatsapp", ""), customer["name"], {})
        return result

    @staticmethod
    async def retry_pending(router_id: str | None = None) -> dict:
        q: dict = {"status": "pending"}
        if router_id:
            q["router_id"] = router_id
        done = failed = 0
        for item in await db.mikrotik_pending.find(q, {"_id": 0}).to_list(200):
            customer = await db.customers.find_one({"id": item["customer_id"]}, {"_id": 0})
            if not customer:
                await db.mikrotik_pending.update_one({"id": item["id"]}, {"$set": {"status": "cancelled"}})
                continue
            res = await MikroTikBillingService.execute(customer, [tuple(o) for o in item["ops"]], "system", item["reason"] + " (retry)", queue_on_fail=False)
            attempts = item["attempts"] + 1
            if res == "SUCCESS":
                done += 1
                disabled = any(o[1] == "disable_pppoe_user" for o in item["ops"])
                enabled = any(o[1] == "enable_pppoe_user" for o in item["ops"])
                patch = {"mikrotik_disabled": True} if disabled else ({"mikrotik_disabled": False} if enabled else {})
                if patch:
                    await db.customers.update_one({"id": customer["id"]}, {"$set": patch})
                await db.mikrotik_pending.update_one({"id": item["id"]}, {"$set": {"status": "done", "attempts": attempts, "done_at": now_iso()}})
            else:
                failed += 1
                await db.mikrotik_pending.update_one({"id": item["id"]}, {"$set": {"attempts": attempts, "status": "failed" if attempts >= 10 else "pending"}})
        return {"done": done, "failed": failed}


class MikroTikCustomerService:
    @staticmethod
    async def create_secret(customer: dict, password: str, profile: str, service: str, comment: str, actor: str) -> str:
        router = await db.mikrotik_routers.find_one({"id": customer.get("router_id")}, {"_id": 0})
        if not router or not customer.get("pppoe_username"):
            return "SKIPPED"
        try:
            mid = await MikroTikConnectionService.call(router, "create_pppoe_user", customer["pppoe_username"], password, profile, service, comment)
            await db.customers.update_one({"id": customer["id"]}, {"$set": {"mikrotik_id": mid, "integration_status": "OK", "integration_error": "", "pppoe_profile": profile}})
            await log_action(router, "CREATE_USER", "SUCCESS", actor, customer["pppoe_username"], customer, "Pelanggan baru", message=f"PPP Secret {mid} profile {profile}")
            await audit({"email": actor, "role": "user"}, "CREATE_PPPOE", "customer", customer["id"], customer["pppoe_username"])
            return "SUCCESS"
        except MikroTikError as e:
            await db.customers.update_one({"id": customer["id"]}, {"$set": {"integration_status": "MIKROTIK_SYNC_FAILED", "integration_error": e.message}})
            await log_action(router, "CREATE_USER", "FAILED", actor, customer["pppoe_username"], customer, "Pelanggan baru", e.code, e.message)
            await notify("sync_failed", "Sinkronisasi gagal", f"Gagal membuat PPPoE {customer['pppoe_username']}: {e.code}")
            return "FAILED"

    @staticmethod
    async def manual(customer: dict, action: str, actor: str, reason: str) -> str:
        mapping = {"enable": [("ENABLE_USER", "enable_pppoe_user", ())],
                   "disable": [("DISABLE_USER", "disable_pppoe_user", ())],
                   "disconnect": [("DISCONNECT_USER", "disconnect_pppoe_user", ())]}
        res = await MikroTikBillingService.execute(customer, mapping[action], actor, reason, queue_on_fail=False)
        if res == "SUCCESS" and action in ("enable", "disable"):
            await db.customers.update_one({"id": customer["id"]}, {"$set": {
                "mikrotik_disabled": action == "disable", "connection_status": "online" if action == "enable" else "offline",
                ("last_online" if action == "enable" else "last_offline"): now_iso()}})
        await audit({"email": actor, "role": "user"}, f"{action.upper()}_PPPOE", "customer", customer["id"], f"{customer.get('pppoe_username')} → {res}")
        return res

    @staticmethod
    async def sync_router(router: dict, actor: str) -> dict:
        counts = {"synced": 0, "created": 0, "updated": 0, "skipped": 0, "failed": 0, "errors": []}
        try:
            secrets = await MikroTikConnectionService.call(router, "get_ppp_secrets")
            active = {a["name"]: a for a in await MikroTikConnectionService.call(router, "get_ppp_active")}
        except MikroTikError as e:
            await log_action(router, "SYNC", "FAILED", actor, error_code=e.code, message=e.message)
            await notify("sync_failed", "Sinkronisasi gagal", f"{router['name']}: {e.message}")
            raise
        by_name = {s["name"]: s for s in secrets}
        customers = await db.customers.find({"router_id": router["id"]}, {"_id": 0}).to_list(5000)
        known = set()
        for c in customers:
            u = c.get("pppoe_username")
            if not u:
                counts["skipped"] += 1
                continue
            known.add(u)
            sec = by_name.get(u)
            if not sec:
                pkg = await db.packages.find_one({"id": c.get("package_id")}) or {}
                try:
                    from lib.security import decrypt_secret as _d
                    await MikroTikConnectionService.call(router, "create_pppoe_user", u, _d(c.get("pppoe_password_enc", "")) or u,
                                                         pkg.get("mikrotik_profile", "default"), "pppoe", f"{c['customer_code']} {c['name']}")
                    counts["created"] += 1
                except MikroTikError as e:
                    counts["failed"] += 1
                    counts["errors"].append(f"{u}: {e.code}")
                continue
            act = active.get(u)
            patch = {"mikrotik_id": sec.get(".id") or sec.get("id"), "pppoe_profile": sec.get("profile", ""),
                     "service": sec.get("service", "pppoe"), "mikrotik_disabled": bool(sec.get("disabled")),
                     "comment": sec.get("comment", ""), "integration_status": "OK",
                     "connection_status": "online" if act else "offline"}
            if act:
                patch.update({"ip_address": act.get("address", ""), "mac_address": act.get("caller-id", act.get("caller_id", "")),
                              "uptime": act.get("uptime", ""), "last_online": now_iso(), "interface": f"<pppoe-{u}>"})
            elif c.get("connection_status") == "online":
                patch["last_offline"] = now_iso()
            changed = any(c.get(k) != v for k, v in patch.items() if k not in ("last_online", "uptime"))
            await db.customers.update_one({"id": c["id"]}, {"$set": patch})
            counts["updated" if changed else "synced"] += 1
        counts["skipped"] += len([n for n in by_name if n not in known])
        counts["synced"] += counts["updated"]
        await db.mikrotik_routers.update_one({"id": router["id"]}, {"$set": {"last_sync": now_iso()}})
        await log_action(router, "SYNC", "SUCCESS" if not counts["failed"] else "FAILED", actor,
                         message=f"Synced {counts['synced']}, Created {counts['created']}, Updated {counts['updated']}, Skipped {counts['skipped']}, Failed {counts['failed']}")
        await audit({"email": actor, "role": "user"}, "SYNC_MIKROTIK", "router", router["id"], router["name"])
        return counts
