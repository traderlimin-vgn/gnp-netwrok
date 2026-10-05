from typing import Literal

from pydantic import BaseModel, Field, field_validator

AssetType = Literal["odc", "odp", "pole"]
CableKind = Literal["feeder", "distribution", "drop"]


class MapAssetIn(BaseModel):
    type: AssetType
    name: str = Field(min_length=2, max_length=60)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    capacity: int = Field(default=0, ge=0, le=1024)
    parent_id: str = ""
    notes: str = Field(default="", max_length=500)


class MapAsset(MapAssetIn):
    id: str
    used: int = 0
    children: int = 0


class CableIn(BaseModel):
    name: str = Field(default="", max_length=80)
    kind: CableKind = "distribution"
    from_id: str = ""
    to_id: str = ""
    path: list[list[float]] = Field(min_length=2, max_length=500)
    core_count: int = Field(default=12, ge=1, le=288)
    notes: str = Field(default="", max_length=500)

    @field_validator("path")
    @classmethod
    def _path(cls, v: list[list[float]]) -> list[list[float]]:
        for p in v:
            if len(p) != 2 or not (-90 <= p[0] <= 90 and -180 <= p[1] <= 180):
                raise ValueError("Titik jalur kabel harus [latitude, longitude] yang valid")
        return v


class Cable(CableIn):
    id: str
    length_m: float = 0
    from_name: str = ""
    to_name: str = ""


class FaultHistory(BaseModel):
    id: str
    fault_key: str
    level: Literal["odc", "odp", "drop"]
    severity: Literal["down", "warning"]
    title: str
    segment: str
    latitude: float
    longitude: float
    odp_id: str = ""
    odc_id: str = ""
    affected_max: int = 0
    status: Literal["open", "resolved"]
    started_at: str
    resolved_at: str | None = None
    duration_min: int = 0


class FaultHotspot(BaseModel):
    segment: str
    level: Literal["odc", "odp", "drop"]
    count: int
    total_duration_min: int
    affected_max: int
    last_at: str
    open: bool
    latitude: float
    longitude: float


class FaultTrendPoint(BaseModel):
    date: str
    faults: int = 0
    down: int = 0
    affected: int = 0


class LevelCount(BaseModel):
    level: str
    count: int


class FaultTrendSummary(BaseModel):
    total: int = 0
    open: int = 0
    resolved: int = 0
    mttr_min: int = 0
    affected_total: int = 0
    by_level: list[LevelCount] = []


class FaultTrend(BaseModel):
    days: int
    points: list[FaultTrendPoint]
    summary: FaultTrendSummary
