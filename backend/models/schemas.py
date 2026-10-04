"""Pydantic v2 request/response models. Mirrored by hand in frontend/src/lib/types.ts."""

import re
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

T = TypeVar("T")
WA_RE = re.compile(r"^(62|0)8\d{7,12}$")
IP_RE = re.compile(r"^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$")
HOST_RE = re.compile(r"^[A-Za-z0-9.\-]{1,253}$")
PPP_RE = re.compile(r"^[A-Za-z0-9._@\-]{3,64}$")


def norm_wa(v: str) -> str:
    v = re.sub(r"[\s\-+]", "", v or "")
    if v and not WA_RE.match(v):
        raise ValueError("Nomor WhatsApp tidak valid (contoh: 6281234567890)")
    return "62" + v[1:] if v.startswith("0") else v


class Out(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Paged(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    limit: int


# ---------- auth / users ----------
Role = Literal["super_admin", "admin", "finance", "cs", "teknisi", "supervisor"]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=128)


class User(Out):
    id: str
    email: str
    name: str
    role: Role
    phone: str = ""
    active: bool = True
    latitude: float | None = None
    longitude: float | None = None
    created_at: str = ""


class Me(User):
    permissions: list[str]


class UserIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=2, max_length=80)
    role: Role
    phone: str = ""
    password: str | None = Field(default=None, min_length=8, max_length=128)
    active: bool = True

    @field_validator("phone")
    @classmethod
    def _wa(cls, v): return norm_wa(v)


# ---------- packages ----------
class PackageIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    speed: str = Field(min_length=1, max_length=30)
    price: int = Field(ge=0, le=100_000_000)
    upload: str = ""
    download: str = ""
    fup: str = ""
    description: str = ""
    active: bool = True
    mikrotik_profile: str = Field(default="", max_length=60)


class Package(PackageIn, Out):
    id: str
    subscribers: int = 0


# ---------- customers ----------
CustStatus = Literal["active", "suspend", "isolir", "stopped", "pending"]


class CustomerIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    whatsapp: str
    alt_phone: str = ""
    address: str = ""
    rt: str = ""
    rw: str = ""
    village: str = ""
    district: str = ""
    city: str = ""
    province: str = ""
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    package_id: str
    install_date: str = ""
    due_day: int = Field(default=10, ge=1, le=28)
    status: CustStatus = "active"
    technician_id: str = ""
    notes: str = ""
    odp_id: str = ""
    router_id: str = ""
    pppoe_username: str = ""
    pppoe_password: str = ""
    service: str = "pppoe"
    comment: str = ""
    create_pppoe: bool = False

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v): return norm_wa(v)

    @field_validator("alt_phone")
    @classmethod
    def _alt(cls, v): return norm_wa(v) if v else ""

    @field_validator("pppoe_username")
    @classmethod
    def _ppp(cls, v):
        if v and not PPP_RE.match(v):
            raise ValueError("Username PPPoE 3-64 karakter: huruf, angka, . _ - @")
        return v

    @field_validator("pppoe_password")
    @classmethod
    def _pw(cls, v):
        if v and not (4 <= len(v) <= 64):
            raise ValueError("Password PPPoE 4-64 karakter")
        return v


class Customer(Out):
    id: str
    customer_code: str
    name: str
    whatsapp: str
    alt_phone: str = ""
    address: str = ""
    rt: str = ""
    rw: str = ""
    village: str = ""
    district: str = ""
    city: str = ""
    province: str = ""
    latitude: float | None = None
    longitude: float | None = None
    package_id: str = ""
    package_name: str = ""
    package_price: int = 0
    install_date: str = ""
    due_day: int = 10
    status: str = "active"
    technician_id: str = ""
    technician_name: str = ""
    notes: str = ""
    odp_id: str = ""
    odp_name: str = ""
    router_id: str = ""
    router_name: str = ""
    pppoe_username: str = ""
    has_pppoe_password: bool = False
    pppoe_profile: str = ""
    service: str = "pppoe"
    comment: str = ""
    mikrotik_id: str = ""
    ip_address: str = ""
    mac_address: str = ""
    connection_status: str = "unknown"
    last_online: str | None = None
    last_offline: str | None = None
    uptime: str = ""
    interface: str = ""
    rx_bytes: int = 0
    tx_bytes: int = 0
    mikrotik_disabled: bool = False
    integration_status: str = "NOT_LINKED"
    integration_error: str = ""
    unpaid_count: int = 0
    created_at: str = ""


class CustomerSaveResult(BaseModel):
    customer: Customer
    mikrotik_result: str


# ---------- billing ----------
InvStatus = Literal["unpaid", "paid", "overdue", "cancelled"]


class Invoice(Out):
    id: str
    invoice_no: str
    customer_id: str
    customer_name: str
    customer_code: str
    whatsapp: str = ""
    package_name: str = ""
    period: str
    amount: int
    discount: int = 0
    penalty: int = 0
    total: int
    due_date: str
    status: InvStatus
    paid_at: str | None = None
    created_at: str = ""


class InvoiceGenerateIn(BaseModel):
    period: str = Field(default="", pattern=r"^(\d{4}-\d{2})?$")


class InvoiceGenerateOut(BaseModel):
    period: str
    created: int
    skipped: int
    job_id: str = ""


class InvoiceUpdate(BaseModel):
    discount: int | None = Field(default=None, ge=0)
    penalty: int | None = Field(default=None, ge=0)
    status: Literal["cancelled", "unpaid"] | None = None


# ---------- payments ----------
PayMethod = Literal["cash", "transfer", "ewallet", "gateway"]


class PaymentIn(BaseModel):
    invoice_id: str
    method: PayMethod
    amount: int = Field(gt=0)
    reference: str = ""
    note: str = ""
    proof_url: str = ""
    confirm: bool = True


class Payment(Out):
    id: str
    payment_no: str
    invoice_id: str
    invoice_no: str
    customer_id: str
    customer_name: str
    customer_code: str = ""
    whatsapp: str = ""
    period: str = ""
    amount: int
    method: PayMethod
    reference: str = ""
    proof_url: str = ""
    note: str = ""
    status: Literal["confirmed", "pending"]
    received_by: str = ""
    paid_at: str


# ---------- mikrotik ----------
class RouterIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    location: str = ""
    host: str
    api_port: int = Field(default=8728, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=60)
    password: str | None = Field(default=None, max_length=128)
    routeros_version: str = ""
    mode: Literal["api", "simulator"] = "api"
    latitude: float | None = None
    longitude: float | None = None

    @field_validator("host")
    @classmethod
    def _host(cls, v):
        v = v.strip()
        if not (IP_RE.match(v) or HOST_RE.match(v)):
            raise ValueError("Host/IP tidak valid")
        return v


class Router(Out):
    id: str
    router_code: str
    name: str
    location: str = ""
    host: str
    api_port: int
    username: str
    has_password: bool = False
    routeros_version: str = ""
    connection_type: str = "api"
    mode: str = "api"
    status: str = "unknown"
    identity: str = ""
    last_connected: str | None = None
    last_sync: str | None = None
    last_error: str = ""
    last_test_ok: bool = False
    response_ms: int = 0
    cpu: int = 0
    memory_used_pct: int = 0
    uptime: str = ""
    customers: int = 0
    latitude: float | None = None
    longitude: float | None = None


class TestStep(BaseModel):
    key: str
    label: str
    ok: bool
    detail: str = ""


class TestResult(BaseModel):
    success: bool
    steps: list[TestStep]
    error_code: str = ""
    message: str = ""
    identity: str = ""
    version: str = ""
    response_ms: int = 0


class SyncResult(BaseModel):
    synced: int
    created: int
    updated: int
    skipped: int
    failed: int
    errors: list[str] = []


class PppSession(BaseModel):
    router_id: str
    router_name: str
    username: str
    customer_id: str = ""
    customer_name: str = ""
    address: str = ""
    caller_id: str = ""
    uptime: str = ""
    service: str = "pppoe"
    profile: str = ""
    interface: str = ""
    status: Literal["online", "offline", "connecting", "unknown"]
    disabled: bool = False
    rx_bps: int = 0
    tx_bps: int = 0


class MikrotikAction(Out):
    id: str
    created_at: str
    actor: str
    router_id: str = ""
    router_name: str = ""
    action: str
    username: str = ""
    customer_id: str = ""
    customer_name: str = ""
    reason: str = ""
    result: str
    error_code: str = ""
    message: str = ""


class PendingAction(Out):
    id: str
    router_name: str
    customer_name: str
    username: str
    reason: str = ""
    attempts: int
    status: str
    last_error: str = ""
    created_at: str


class ActionResult(BaseModel):
    result: str
    message: str


class AutomationResult(BaseModel):
    overdue_marked: int
    isolated: int
    skipped: int
    auto_isolation: bool


class Settings(BaseModel):
    mikrotik_enabled: bool
    default_protocol: Literal["api"] = "api"
    api_port: int = Field(ge=1, le=65535)
    timeout_ms: int = Field(ge=1000, le=60000)
    retry_count: int = Field(ge=1, le=5)
    polling_interval: int = Field(ge=30, le=600)
    auto_sync: bool
    auto_isolation: bool
    auto_activation: bool
    grace_days: int = Field(ge=0, le=60)
    isolation_methods: list[Literal["disable_secret", "change_profile", "disconnect"]]
    isolation_profile: str
    due_day: int = Field(ge=1, le=28)
    late_fee: int = Field(ge=0)
    company_name: str
    company_phone: str
    company_address: str
    whatsapp_provider: str


# ---------- whatsapp ----------
class WhatsAppSendIn(BaseModel):
    to: str
    message: str = Field(min_length=1, max_length=4000)
    name: str = ""

    @field_validator("to")
    @classmethod
    def _wa(cls, v): return norm_wa(v)


class WhatsAppMessage(Out):
    id: str
    to: str
    name: str = ""
    template: str
    message: str
    status: str
    provider: str
    error: str = ""
    created_at: str


# ---------- tickets / psb ----------
class TicketIn(BaseModel):
    customer_id: str
    complaint: str = Field(min_length=3, max_length=2000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    technician_id: str = ""
    notes: str = ""


class TicketUpdate(BaseModel):
    status: Literal["open", "assigned", "in_progress", "resolved", "closed"] | None = None
    technician_id: str | None = None
    priority: Literal["low", "medium", "high", "critical"] | None = None
    notes: str | None = None
    photo_url: str | None = None


class Ticket(Out):
    id: str
    ticket_no: str
    customer_id: str
    customer_name: str
    whatsapp: str = ""
    address: str = ""
    latitude: float | None = None
    longitude: float | None = None
    complaint: str
    priority: str
    technician_id: str = ""
    technician_name: str = ""
    status: str
    photos: list[str] = []
    notes: str = ""
    reported_at: str
    resolved_at: str | None = None


class PsbIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    whatsapp: str
    address: str = ""
    rt: str = ""
    rw: str = ""
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    package_id: str
    technician_id: str = ""
    schedule: str = ""
    notes: str = ""

    @field_validator("whatsapp")
    @classmethod
    def _wa(cls, v): return norm_wa(v)


class PsbUpdate(BaseModel):
    status: Literal["new", "scheduled", "installing", "done", "cancelled"] | None = None
    technician_id: str | None = None
    schedule: str | None = None
    notes: str | None = None
    photo_url: str | None = None


class Psb(Out):
    id: str
    psb_no: str
    name: str
    whatsapp: str
    address: str = ""
    rt: str = ""
    rw: str = ""
    latitude: float | None = None
    longitude: float | None = None
    package_id: str = ""
    package_name: str = ""
    technician_id: str = ""
    technician_name: str = ""
    schedule: str = ""
    status: str
    notes: str = ""
    photos: list[str] = []
    customer_id: str = ""
    created_at: str


# ---------- misc ----------
class MapPoint(BaseModel):
    id: str
    type: Literal["customer", "odp", "odc", "technician", "psb", "ticket", "router"]
    name: str
    latitude: float
    longitude: float
    status: str = ""
    info: str = ""
    parent_id: str = ""


class Notification(Out):
    id: str
    type: str
    title: str
    message: str
    read: bool
    created_at: str


class AuditLog(Out):
    id: str
    created_at: str
    actor: str
    role: str
    action: str
    entity: str = ""
    entity_id: str = ""
    detail: str = ""
    ip: str = ""


class UploadOut(BaseModel):
    url: str
