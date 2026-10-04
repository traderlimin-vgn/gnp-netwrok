from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AcsConfigIn(BaseModel):
    enabled: bool = True
    mode: Literal["simulator", "nbi"] = "simulator"
    url: str = Field(default="http://127.0.0.1:7557", max_length=200)
    username: str = Field(default="", max_length=80)
    password: str | None = Field(default=None, max_length=128)
    online_minutes: int = Field(default=10, ge=1, le=1440)

    @field_validator("url")
    @classmethod
    def _url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL NBI harus diawali http:// atau https:// (contoh http://103.x.x.x:7557)")
        return v


class AcsConfig(BaseModel):
    enabled: bool
    mode: Literal["simulator", "nbi"]
    url: str
    username: str
    has_password: bool
    online_minutes: int
    last_test: str | None = None
    last_test_ok: bool | None = None


class AcsTestResult(BaseModel):
    success: bool
    message: str
    devices: int
    response_ms: int


class AcsDevice(BaseModel):
    id: str
    serial: str = ""
    manufacturer: str = ""
    model: str = ""
    software: str = ""
    pppoe_username: str = ""
    ip: str = ""
    last_inform: str | None = None
    rx_power: float | None = None
    tx_power: float | None = None
    temperature: float | None = None
    ssid: str = ""
    wifi_clients: int = 0
    uptime: int = 0
    status: Literal["online", "offline", "unknown"]
    customer_id: str = ""
    customer_name: str = ""
    customer_code: str = ""
    link_type: Literal["manual", "auto", ""] = ""


class AcsWifiIn(BaseModel):
    ssid: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=8, max_length=63)


class AcsLinkIn(BaseModel):
    customer_id: str = ""


class AcsActionResult(BaseModel):
    result: Literal["DONE", "QUEUED"]
    message: str
