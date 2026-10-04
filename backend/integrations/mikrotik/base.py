"""IMikroTikProvider — the contract every MikroTik transport implements (RouterOS API 8728, simulator)."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


ERROR_MESSAGES = {
    "MIKROTIK_CONNECTION_FAILED": "Tidak dapat terhubung ke router. Periksa host, port API, firewall dan jalur VPN/WireGuard.",
    "MIKROTIK_AUTH_FAILED": "Autentikasi gagal. Periksa username/password user API (mis. gmp-api).",
    "MIKROTIK_TIMEOUT": "Router tidak merespons dalam batas waktu (timeout).",
    "MIKROTIK_COMMAND_FAILED": "Perintah ditolak oleh router.",
    "MIKROTIK_USER_NOT_FOUND": "PPP secret tidak ditemukan di router.",
    "MIKROTIK_ROUTER_OFFLINE": "Router sedang offline. Aksi dimasukkan ke antrian dan akan dicoba ulang.",
    "MIKROTIK_DISABLED": "Integrasi MikroTik dinonaktifkan di pengaturan.",
}


class MikroTikError(Exception):
    def __init__(self, code: str, detail: str = ""):
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {ERROR_MESSAGES.get(code, '')} {detail}".strip())

    @property
    def message(self) -> str:
        return ERROR_MESSAGES.get(self.code, self.code) + (f" ({self.detail})" if self.detail else "")


@dataclass
class RouterConfig:
    id: str
    name: str
    host: str
    port: int
    username: str
    password: str
    timeout: float
    raw: dict


class IMikroTikProvider(ABC):
    def __init__(self, cfg: RouterConfig):
        self.cfg = cfg

    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def test_connection(self) -> dict: ...
    @abstractmethod
    async def get_identity(self) -> str: ...
    @abstractmethod
    async def get_routeros_version(self) -> str: ...
    @abstractmethod
    async def get_system_resource(self) -> dict: ...
    @abstractmethod
    async def get_interfaces(self) -> list[dict]: ...
    @abstractmethod
    async def get_ppp_secrets(self) -> list[dict]: ...
    @abstractmethod
    async def get_ppp_active(self) -> list[dict]: ...
    @abstractmethod
    async def get_profiles(self) -> list[dict]: ...
    @abstractmethod
    async def get_hotspot_users(self) -> list[dict]: ...
    @abstractmethod
    async def get_hotspot_active(self) -> list[dict]: ...
    @abstractmethod
    async def get_users(self) -> list[dict]: ...
    @abstractmethod
    async def create_pppoe_user(self, name: str, password: str, profile: str, service: str, comment: str) -> str: ...
    @abstractmethod
    async def update_pppoe_user(self, name: str, **fields) -> None: ...
    @abstractmethod
    async def disable_pppoe_user(self, name: str) -> bool: ...
    @abstractmethod
    async def enable_pppoe_user(self, name: str) -> bool: ...
    @abstractmethod
    async def delete_pppoe_user(self, name: str) -> None: ...
    @abstractmethod
    async def disconnect_pppoe_user(self, name: str) -> bool: ...
    async def set_profile(self, name: str, profile: str) -> bool:
        await self.update_pppoe_user(name, profile=profile)
        return True

    @abstractmethod
    async def get_traffic(self, interface: str | None = None) -> list[dict]: ...
    @abstractmethod
    async def get_logs(self, limit: int = 50) -> list[dict]: ...
