from typing import Literal

from pydantic import BaseModel, Field


class WaConfigIn(BaseModel):
    provider: Literal["simulator", "fonnte"] = "simulator"
    token: str | None = Field(default=None, max_length=256)
    country_code: str = Field(default="62", max_length=4)
    device_label: str = Field(default="", max_length=80)


class WaConfig(BaseModel):
    provider: Literal["simulator", "fonnte"]
    country_code: str
    device_label: str
    has_token: bool
    last_test: str | None = None
    last_test_ok: bool | None = None


class WaTestIn(BaseModel):
    to: str = Field(min_length=8, max_length=20)


class WaTestResult(BaseModel):
    success: bool
    message: str
    provider: str
    response_ms: int
