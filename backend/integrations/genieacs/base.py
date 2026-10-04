"""IGenieAcsProvider — contract for TR-069 ACS transports (GenieACS NBI, simulator).
Providers return *normalized* device dicts so billing/UI never touch raw TR-069 parameter trees."""

from abc import ABC, abstractmethod

ERROR_MESSAGES = {
    "GENIEACS_DISABLED": "Integrasi GenieACS dinonaktifkan di Pengaturan.",
    "GENIEACS_CONNECTION_FAILED": "Tidak dapat terhubung ke GenieACS NBI. Periksa URL/port (default 7557) dan firewall.",
    "GENIEACS_TIMEOUT": "GenieACS tidak merespons dalam batas waktu.",
    "GENIEACS_AUTH_FAILED": "Autentikasi GenieACS NBI gagal. Periksa username/password.",
    "GENIEACS_DEVICE_NOT_FOUND": "Perangkat tidak ditemukan di GenieACS.",
    "GENIEACS_TASK_FAILED": "Task TR-069 gagal dijalankan oleh perangkat.",
}


class AcsError(Exception):
    def __init__(self, code: str, detail: str = ""):
        self.code = code
        self.message = ERROR_MESSAGES.get(code, code) + (f" ({detail})" if detail else "")
        super().__init__(self.message)


class IGenieAcsProvider(ABC):
    """Normalized device keys: id, serial, manufacturer, model, software, pppoe_username, ip, last_inform (ISO),
    rx_power, tx_power, temperature (float|None), ssid, wifi_clients (int), uptime (seconds)."""

    @abstractmethod
    async def test(self) -> int: ...  # returns device count

    @abstractmethod
    async def list_devices(self) -> list[dict]: ...

    @abstractmethod
    async def set_wifi(self, device_id: str, ssid: str, password: str) -> str: ...  # "DONE" | "QUEUED"

    @abstractmethod
    async def reboot(self, device_id: str) -> str: ...

    @abstractmethod
    async def refresh(self, device_id: str) -> str: ...
