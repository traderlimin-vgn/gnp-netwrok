from typing import Literal

from pydantic import BaseModel


class OntState(BaseModel):
    customer_id: str
    customer_name: str
    customer_code: str
    ont_status: Literal["online", "offline", "weak"]
    rx_power: float | None = None
    serial: str = ""


class Fault(BaseModel):
    id: str
    level: Literal["odc", "odp", "drop"]
    severity: Literal["down", "warning"]
    title: str
    segment: str
    message: str
    latitude: float
    longitude: float
    odp_id: str = ""
    odc_id: str = ""
    affected: list[OntState]
    affected_count: int


class OdpHealth(BaseModel):
    odp_id: str
    odp_name: str
    odc_id: str
    odc_name: str
    latitude: float
    longitude: float
    total: int
    online: int
    offline: int
    weak: int
    severity: Literal["ok", "warning", "down"]


class OdcHealth(BaseModel):
    odc_id: str
    odc_name: str
    latitude: float
    longitude: float
    odps_total: int
    odps_down: int
    severity: Literal["ok", "warning", "down"]


class FaultReport(BaseModel):
    generated_at: str
    faults: list[Fault]
    odps: list[OdpHealth]
    odcs: list[OdcHealth]
    onts: list[OntState]


class SimulateCutIn(BaseModel):
    odp_id: str
    cut: bool = True
