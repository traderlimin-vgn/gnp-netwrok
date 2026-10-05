"""WhatsApp integration layer: IWhatsAppProvider + providers (simulator / Fonnte) + WhatsAppService.

Provider & credentials are configurable at runtime from Settings (stored in the `whatsapp`
settings doc, token encrypted with Fernet) — the simulator stays the default so preview/testing
never sends real messages. The Fonnte token is never returned to the browser.
"""

import os
import time
from abc import ABC, abstractmethod

import httpx

from lib.core import audit, now_iso, uid
from lib.db import db
from lib.security import decrypt_secret, encrypt_secret

TEMPLATES = {
    "invoice": "Halo {nama},\n\nTagihan internet Network GMP Anda:\n\nInvoice: {invoice}\nPeriode: {periode}\nTotal: {total}\nJatuh Tempo: {tanggal}\n\nSilakan melakukan pembayaran sebelum tanggal jatuh tempo.\n\nTerima kasih.\nNETWORK GMP",
    "payment": "Pembayaran Anda telah diterima.\n\nInvoice: {invoice}\nTotal: {total}\nStatus: LUNAS\n\nTerima kasih.\nNETWORK GMP",
    "isolation": "Halo {nama},\n\nLayanan internet Anda saat ini masuk status ISOLIR karena terdapat tagihan yang belum dibayar.\n\nSilakan melakukan pembayaran untuk mengaktifkan kembali layanan.\n\nNETWORK GMP",
    "activation": "Pembayaran berhasil.\n\nLayanan internet Anda sedang diaktifkan kembali.\n\nTerima kasih.\nNETWORK GMP",
    "ticket_technician": "🚨 TIKET GANGGUAN BARU\n\nNo Tiket: {ticket}\nPelanggan: {nama}\nWhatsApp: {nomor}\nAlamat: {alamat}\nKeluhan: {keluhan}\n\nLokasi:\n{google_maps_link}\n\nSilakan segera ditindaklanjuti.\nNETWORK GMP",
    "psb_technician": "📡 JADWAL PASANG BARU (PSB)\n\nNo PSB: {psb}\nNama: {nama}\nWhatsApp: {nomor}\nAlamat: {alamat}\nPaket: {paket}\nJadwal: {jadwal}\n\nLokasi:\n{google_maps_link}\n\nNETWORK GMP",
}

CONFIG_DEFAULTS = {"provider": "simulator", "token_enc": "", "country_code": "62", "device_label": ""}


def rupiah(n: float | int) -> str:
    return "Rp " + f"{int(n):,}".replace(",", ".")


def maps_link(lat, lng) -> str:
    return f"https://www.google.com/maps?q={lat},{lng}" if lat and lng else "-"


def _fonnte_target(to: str) -> tuple[str, str]:
    """Return (target, countryCode) for Fonnte. App stores numbers as 62xxxx (norm_wa)."""
    digits = "".join(c for c in (to or "") if c.isdigit())
    if digits.startswith("62"):
        return digits, "0"          # already international
    if digits.startswith("0"):
        return digits, "62"         # local 08xx; Fonnte replaces leading 0 with 62
    return digits, "62"


class IWhatsAppProvider(ABC):
    name = "base"

    @abstractmethod
    async def send(self, to: str, message: str) -> tuple[bool, str]: ...


class SimulatorWhatsAppProvider(IWhatsAppProvider):
    """Logs the message only — no real WhatsApp delivery. Safe default for preview/testing."""
    name = "simulator"

    async def send(self, to, message):
        return True, "simulated"


class FonnteWhatsAppProvider(IWhatsAppProvider):
    """Fonnte gateway (https://fonnte.com): a personal WhatsApp number paired via QR in the
    Fonnte dashboard. Auth = raw device token in the Authorization header (no 'Bearer')."""
    name = "fonnte"
    URL = "https://api.fonnte.com/send"

    def __init__(self, token: str, country_code: str = "62"):
        self.token = token
        self.country_code = country_code or "62"

    async def send(self, to, message):
        if not self.token:
            return False, "Token Fonnte belum dikonfigurasi di Pengaturan → WhatsApp"
        target, cc = _fonnte_target(to)
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.post(self.URL, headers={"Authorization": self.token},
                                 data={"target": target, "message": message, "countryCode": cc, "connectOnly": "true"})
        except httpx.TimeoutException:
            return False, "Timeout menghubungi gateway Fonnte"
        except httpx.HTTPError as e:
            return False, f"Gagal menghubungi Fonnte: {e}"
        try:
            body = r.json()
        except ValueError:
            return False, f"Respons Fonnte tidak valid (HTTP {r.status_code})"
        # Do not trust HTTP 200 alone — Fonnte signals failure in the JSON `status` field.
        if body.get("status") is True:
            ids = body.get("id") or []
            return True, f"queued id={ids[0]}" if ids else "queued"
        reason = str(body.get("reason") or body.get("detail") or "permintaan ditolak Fonnte")
        low = reason.lower()
        if any(w in low for w in ("disconnect", "not connected", "device")):
            return False, f"Perangkat Fonnte terputus — scan ulang QR di dashboard ({reason})"
        return False, reason


# ---------- runtime config (settings doc `_id: "whatsapp"`) ----------
async def raw_config() -> dict:
    doc = await db.settings.find_one({"_id": "whatsapp"}) or {}
    doc.pop("_id", None)
    return {**CONFIG_DEFAULTS, **doc}


async def config_out() -> dict:
    c = await raw_config()
    return {"provider": c["provider"], "country_code": c["country_code"], "device_label": c["device_label"],
            "has_token": bool(c.get("token_enc")), "last_test": c.get("last_test"), "last_test_ok": c.get("last_test_ok")}


async def save_config(body: dict, actor: dict) -> dict:
    patch = {"provider": body["provider"], "country_code": body.get("country_code") or "62", "device_label": body.get("device_label", "")}
    if body.get("token"):
        patch["token_enc"] = encrypt_secret(body["token"])
    await db.settings.update_one({"_id": "whatsapp"}, {"$set": patch}, upsert=True)
    # keep the general Settings tab's read-only display in sync
    await db.settings.update_one({"_id": "app"}, {"$set": {"whatsapp_provider": patch["provider"]}}, upsert=True)
    await audit(actor, "KONFIGURASI_WHATSAPP", "whatsapp", "", f"provider={patch['provider']}")
    return await config_out()


async def get_provider() -> IWhatsAppProvider:
    c = await raw_config()
    if c["provider"] == "fonnte":
        token = decrypt_secret(c["token_enc"]) if c.get("token_enc") else os.environ.get("FONNTE_API_TOKEN", "")
        return FonnteWhatsAppProvider(token, c.get("country_code", "62"))
    return SimulatorWhatsAppProvider()


class WhatsAppService:
    @staticmethod
    def render(template: str, ctx: dict) -> str:
        return TEMPLATES[template].format_map({k: ("-" if v in (None, "") else v) for k, v in ctx.items()})

    @staticmethod
    async def send(to: str, message: str, name: str = "", template: str = "manual") -> dict:
        provider = await get_provider()
        ok, info = await provider.send(to, message)
        doc = {"id": uid(), "to": to, "name": name, "template": template, "message": message,
               "status": "sent" if ok else "failed", "provider": provider.name,
               "error": "" if ok else info, "created_at": now_iso()}
        await db.whatsapp_messages.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @classmethod
    async def send_template(cls, template: str, to: str, name: str, ctx: dict) -> dict:
        return await cls.send(to, cls.render(template, ctx), name, template)

    @staticmethod
    async def test(to: str, actor: dict) -> dict:
        provider = await get_provider()
        t0 = time.perf_counter()
        ok, info = await provider.send(to, "Tes koneksi WhatsApp NETWORK GMP. Jika pesan ini diterima, gateway sudah aktif. ✅")
        res = {"success": ok, "message": (f"Terkirim via {provider.name}" if ok else info), "provider": provider.name,
               "response_ms": int((time.perf_counter() - t0) * 1000)}
        await db.settings.update_one({"_id": "whatsapp"}, {"$set": {"last_test": now_iso(), "last_test_ok": ok}}, upsert=True)
        await audit(actor, "TEST_WHATSAPP", "whatsapp", "", res["message"])
        return res
