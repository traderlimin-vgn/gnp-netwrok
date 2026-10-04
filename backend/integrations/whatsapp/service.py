"""WhatsApp integration layer: IWhatsAppProvider + providers + WhatsAppService (templates, logging)."""

import os
from abc import ABC, abstractmethod

import httpx

from lib.core import uid, now_iso
from lib.db import db

TEMPLATES = {
    "invoice": "Halo {nama},\n\nTagihan internet Network GMP Anda:\n\nInvoice: {invoice}\nPeriode: {periode}\nTotal: {total}\nJatuh Tempo: {tanggal}\n\nSilakan melakukan pembayaran sebelum tanggal jatuh tempo.\n\nTerima kasih.\nNETWORK GMP",
    "payment": "Pembayaran Anda telah diterima.\n\nInvoice: {invoice}\nTotal: {total}\nStatus: LUNAS\n\nTerima kasih.\nNETWORK GMP",
    "isolation": "Halo {nama},\n\nLayanan internet Anda saat ini masuk status ISOLIR karena terdapat tagihan yang belum dibayar.\n\nSilakan melakukan pembayaran untuk mengaktifkan kembali layanan.\n\nNETWORK GMP",
    "activation": "Pembayaran berhasil.\n\nLayanan internet Anda sedang diaktifkan kembali.\n\nTerima kasih.\nNETWORK GMP",
    "ticket_technician": "🚨 TIKET GANGGUAN BARU\n\nNo Tiket: {ticket}\nPelanggan: {nama}\nWhatsApp: {nomor}\nAlamat: {alamat}\nKeluhan: {keluhan}\n\nLokasi:\n{google_maps_link}\n\nSilakan segera ditindaklanjuti.\nNETWORK GMP",
    "psb_technician": "📡 JADWAL PASANG BARU (PSB)\n\nNo PSB: {psb}\nNama: {nama}\nWhatsApp: {nomor}\nAlamat: {alamat}\nPaket: {paket}\nJadwal: {jadwal}\n\nLokasi:\n{google_maps_link}\n\nNETWORK GMP",
}


def rupiah(n: float | int) -> str:
    return "Rp " + f"{int(n):,}".replace(",", ".")


def maps_link(lat, lng) -> str:
    return f"https://www.google.com/maps?q={lat},{lng}" if lat and lng else "-"


class IWhatsAppProvider(ABC):
    name = "base"

    @abstractmethod
    async def send(self, to: str, message: str) -> tuple[bool, str]: ...


class SimulatorWhatsAppProvider(IWhatsAppProvider):
    """Logs the message only — swap for a gateway (Fonnte/Wablas/WA pribadi via webhook) later."""
    name = "simulator"

    async def send(self, to, message):
        return True, "simulated"


class WebhookWhatsAppProvider(IWhatsAppProvider):
    """Generic gateway (Fonnte-style): POST {target, message} with Authorization token."""
    name = "webhook"

    async def send(self, to, message):
        url, token = os.environ.get("WHATSAPP_GATEWAY_URL"), os.environ.get("WHATSAPP_GATEWAY_TOKEN", "")
        if not url:
            return False, "WHATSAPP_GATEWAY_URL belum dikonfigurasi"
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(url, data={"target": to, "message": message}, headers={"Authorization": token})
            return r.is_success, r.text[:200]
        except httpx.HTTPError as e:
            return False, str(e)


def get_provider() -> IWhatsAppProvider:
    return WebhookWhatsAppProvider() if os.environ.get("WHATSAPP_PROVIDER") == "webhook" else SimulatorWhatsAppProvider()


class WhatsAppService:
    @staticmethod
    def render(template: str, ctx: dict) -> str:
        return TEMPLATES[template].format_map({k: ("-" if v in (None, "") else v) for k, v in ctx.items()})

    @staticmethod
    async def send(to: str, message: str, name: str = "", template: str = "manual") -> dict:
        provider = get_provider()
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
