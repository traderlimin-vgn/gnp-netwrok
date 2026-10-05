// Hand-written mirrors of backend/models/schemas.py — keep in sync.
export type Role = "super_admin" | "admin" | "finance" | "cs" | "teknisi" | "supervisor";

export interface Paged<T> { items: T[]; total: number; page: number; limit: number }

export interface User {
  id: string; email: string; name: string; role: Role; phone: string; active: boolean;
  latitude: number | null; longitude: number | null; created_at: string;
}
export interface Me extends User { permissions: string[] }
export interface UserIn { email: string; name: string; role: Role; phone: string; password?: string | null; active: boolean }

export interface PackageIn {
  name: string; speed: string; price: number; upload: string; download: string; fup: string;
  description: string; active: boolean; mikrotik_profile: string;
}
export interface Package extends PackageIn { id: string; subscribers: number }

export type CustStatus = "active" | "suspend" | "isolir" | "stopped" | "pending";
export interface CustomerIn {
  name: string; whatsapp: string; alt_phone: string; address: string; rt: string; rw: string; village: string;
  district: string; city: string; province: string; latitude: number | null; longitude: number | null;
  package_id: string; install_date: string; due_day: number; status: CustStatus; technician_id: string; notes: string;
  odp_id: string; router_id: string; pppoe_username: string; pppoe_password: string; service: string; comment: string; create_pppoe: boolean;
}
export interface Customer {
  id: string; customer_code: string; name: string; whatsapp: string; alt_phone: string; address: string; rt: string; rw: string;
  village: string; district: string; city: string; province: string; latitude: number | null; longitude: number | null;
  package_id: string; package_name: string; package_price: number; install_date: string; due_day: number; status: string;
  technician_id: string; technician_name: string; notes: string; odp_id: string; odp_name: string; router_id: string; router_name: string;
  pppoe_username: string; has_pppoe_password: boolean; pppoe_profile: string; service: string; comment: string; mikrotik_id: string;
  ip_address: string; mac_address: string; connection_status: string; last_online: string | null; last_offline: string | null;
  uptime: string; interface: string; rx_bytes: number; tx_bytes: number; mikrotik_disabled: boolean;
  integration_status: string; integration_error: string; unpaid_count: number; created_at: string;
}
export interface CustomerSaveResult { customer: Customer; mikrotik_result: string }

export type InvStatus = "unpaid" | "paid" | "overdue" | "cancelled";
export interface Invoice {
  id: string; invoice_no: string; customer_id: string; customer_name: string; customer_code: string; whatsapp: string;
  package_name: string; period: string; amount: number; discount: number; penalty: number; total: number; due_date: string;
  status: InvStatus; paid_at: string | null; created_at: string;
}
export interface InvoiceGenerateOut { period: string; created: number; skipped: number; job_id: string }
export interface InvoiceUpdate { discount?: number | null; penalty?: number | null; status?: "cancelled" | "unpaid" | null }

export type PayMethod = "cash" | "transfer" | "ewallet" | "gateway";
export interface PaymentIn { invoice_id: string; method: PayMethod; amount: number; reference: string; note: string; proof_url: string; confirm: boolean }
export interface Payment {
  id: string; payment_no: string; invoice_id: string; invoice_no: string; customer_id: string; customer_name: string;
  customer_code: string; whatsapp: string; period: string; amount: number; method: PayMethod; reference: string;
  proof_url: string; note: string; status: "confirmed" | "pending"; received_by: string; paid_at: string;
}

export interface RouterIn {
  name: string; location: string; host: string; api_port: number; username: string;
  password?: string | null; routeros_version: string; mode: "api" | "simulator";
  latitude: number | null; longitude: number | null;
}
export interface Router {
  id: string; router_code: string; name: string; location: string; host: string; api_port: number;
  username: string; has_password: boolean; routeros_version: string; connection_type: string;
  mode: string; status: string; identity: string; last_connected: string | null; last_sync: string | null;
  last_error: string; last_test_ok: boolean; response_ms: number; cpu: number; memory_used_pct: number; uptime: string;
  customers: number; latitude: number | null; longitude: number | null;
}
export interface TestStep { key: string; label: string; ok: boolean; detail: string }
export interface TestResult {
  success: boolean; steps: TestStep[]; error_code: string; message: string; identity: string; version: string; response_ms: number;
}
export interface SyncResult { synced: number; created: number; updated: number; skipped: number; failed: number; errors: string[] }
export interface PppSession {
  router_id: string; router_name: string; username: string; customer_id: string; customer_name: string; address: string;
  caller_id: string; uptime: string; service: string; profile: string; interface: string;
  status: "online" | "offline" | "connecting" | "unknown"; disabled: boolean; rx_bps: number; tx_bps: number;
}
export interface MikrotikAction {
  id: string; created_at: string; actor: string; router_id: string; router_name: string; action: string; username: string;
  customer_id: string; customer_name: string; reason: string; result: string; error_code: string; message: string;
}
export interface PendingAction {
  id: string; router_name: string; customer_name: string; username: string; reason: string; attempts: number;
  status: string; last_error: string; created_at: string;
}
export interface ActionResult { result: string; message: string }
export interface AutomationResult { overdue_marked: number; isolated: number; skipped: number; auto_isolation: boolean }
export type IsolationMethod = "disable_secret" | "change_profile" | "disconnect";
export interface Settings {
  mikrotik_enabled: boolean; default_protocol: "api"; api_port: number; timeout_ms: number;
  retry_count: number; polling_interval: number; auto_sync: boolean; auto_isolation: boolean; auto_activation: boolean;
  grace_days: number; isolation_methods: IsolationMethod[]; isolation_profile: string; due_day: number; late_fee: number;
  company_name: string; company_phone: string; company_address: string; whatsapp_provider: string;
}
export interface WhatsAppMessage {
  id: string; to: string; name: string; template: string; message: string; status: string; provider: string; error: string; created_at: string;
}
export type WaProvider = "simulator" | "fonnte";
export interface WaConfigIn { provider: WaProvider; token?: string | null; country_code: string; device_label: string }
export interface WaConfig { provider: WaProvider; country_code: string; device_label: string; has_token: boolean; last_test: string | null; last_test_ok: boolean | null }
export interface WaTestResult { success: boolean; message: string; provider: string; response_ms: number }
export interface TicketIn { customer_id: string; complaint: string; priority: string; technician_id: string; notes: string }
export interface TicketUpdate { status?: string; technician_id?: string; priority?: string; notes?: string; photo_url?: string }
export interface Ticket {
  id: string; ticket_no: string; customer_id: string; customer_name: string; whatsapp: string; address: string;
  latitude: number | null; longitude: number | null; complaint: string; priority: string; technician_id: string;
  technician_name: string; status: string; photos: string[]; notes: string; reported_at: string; resolved_at: string | null;
}
export interface PsbIn {
  name: string; whatsapp: string; address: string; rt: string; rw: string; latitude: number | null; longitude: number | null;
  package_id: string; technician_id: string; schedule: string; notes: string;
}
export interface PsbUpdate { status?: string; technician_id?: string; schedule?: string; notes?: string; photo_url?: string }
export interface Psb extends PsbIn {
  id: string; psb_no: string; package_name: string; technician_name: string; status: string; photos: string[]; customer_id: string; created_at: string;
}
export interface MapPoint {
  id: string; type: "customer" | "odp" | "odc" | "pole" | "technician" | "psb" | "ticket" | "router"; name: string;
  latitude: number; longitude: number; status: string; info: string; parent_id: string;
}
export interface Notification { id: string; type: string; title: string; message: string; read: boolean; created_at: string }
export interface AuditLog { id: string; created_at: string; actor: string; role: string; action: string; entity: string; entity_id: string; detail: string; ip: string }

export interface DashboardStats {
  total_customers: number; active: number; suspend: number; isolir: number; arrears: number; billed_month: number;
  paid_month: number; revenue_today: number; revenue_month: number; new_customers: number; stopped_customers: number;
  technicians: number; routers_online: number; routers_offline: number; pppoe_online: number; pppoe_offline: number;
  open_tickets: number; pending_mikrotik: number;
}
export interface MonthlyPoint { period: string; revenue: number; billed: number; payments: number; invoices: number; new_customers: number; customers: number }
export interface Dashboard {
  stats: DashboardStats; monthly: MonthlyPoint[]; status_distribution: { status: string; count: number }[];
  routers: { router: string; status: string; cpu: number; online: number; offline: number }[]; recent_actions: MikrotikAction[];
}
export interface ReportData {
  period: string;
  finance: { revenue: number; payments_count: number; billed: number; receivable: number; overdue: number; penalty: number; discount: number; by_method: { method: string; total: number; count: number }[] };
  customers: { active: number; isolir: number; stopped: number; new: number };
  mikrotik: { routers: number; routers_online: number; pppoe_online: number; pppoe_offline: number; api_errors: number; syncs: number };
  technicians: { name: string; tickets_done: number; tickets_pending: number; psb_done: number; psb_pending: number }[];
}
export interface TechnicianBoard { tickets: Ticket[]; psb: Psb[]; customers: Customer[] }
export interface Health { status: string; time: string; checks: Record<string, unknown> }
export interface BackupFile { name: string; size: number }

// GenieACS (TR-069) — mirrors backend/models/genieacs.py
export interface AcsConfigIn { enabled: boolean; mode: "simulator" | "nbi"; url: string; username: string; password?: string | null; online_minutes: number }
export interface AcsConfig { enabled: boolean; mode: "simulator" | "nbi"; url: string; username: string; has_password: boolean; online_minutes: number; last_test: string | null; last_test_ok: boolean | null }
export interface AcsTestResult { success: boolean; message: string; devices: number; response_ms: number }
export interface AcsDevice {
  id: string; serial: string; manufacturer: string; model: string; software: string; pppoe_username: string; ip: string;
  last_inform: string | null; rx_power: number | null; tx_power: number | null; temperature: number | null; ssid: string;
  wifi_clients: number; uptime: number; status: "online" | "offline" | "unknown"; customer_id: string; customer_name: string;
  customer_code: string; link_type: "manual" | "auto" | "";
}
export interface AcsWifiIn { ssid: string; password: string }
export interface AcsActionResult { result: "DONE" | "QUEUED"; message: string }

// Network fault localisation — mirrors backend/models/network.py
export interface OntState { customer_id: string; customer_name: string; customer_code: string; ont_status: "online" | "offline" | "weak"; rx_power: number | null; serial: string }
export interface Fault {
  id: string; level: "odc" | "odp" | "drop"; severity: "down" | "warning"; title: string; segment: string; message: string;
  latitude: number; longitude: number; odp_id: string; odc_id: string; affected: OntState[]; affected_count: number;
}
export interface OdpHealth { odp_id: string; odp_name: string; odc_id: string; odc_name: string; latitude: number; longitude: number; total: number; online: number; offline: number; weak: number; severity: "ok" | "warning" | "down" }
export interface OdcHealth { odc_id: string; odc_name: string; latitude: number; longitude: number; odps_total: number; odps_down: number; severity: "ok" | "warning" | "down" }
export interface FaultReport { generated_at: string; faults: Fault[]; odps: OdpHealth[]; odcs: OdcHealth[]; onts: OntState[] }

// Topology + fault history — mirrors backend/models/topology.py
export type AssetType = "odc" | "odp" | "pole";
export type CableKind = "feeder" | "distribution" | "drop";
export interface MapAssetIn { type: AssetType; name: string; latitude: number; longitude: number; capacity: number; parent_id: string; notes: string }
export interface MapAsset extends MapAssetIn { id: string; used: number; children: number }
export interface CableIn { name: string; kind: CableKind; from_id: string; to_id: string; path: number[][]; core_count: number; notes: string }
export interface Cable extends CableIn { id: string; length_m: number; from_name: string; to_name: string }
export interface FaultHistory {
  id: string; fault_key: string; level: "odc" | "odp" | "drop"; severity: "down" | "warning"; title: string; segment: string;
  latitude: number; longitude: number; odp_id: string; odc_id: string; affected_max: number; status: "open" | "resolved";
  started_at: string; resolved_at: string | null; duration_min: number;
}
export interface FaultHotspot { segment: string; level: "odc" | "odp" | "drop"; count: number; total_duration_min: number; affected_max: number; last_at: string; open: boolean; latitude: number; longitude: number }
export interface FaultTrendPoint { date: string; faults: number; down: number; affected: number }
export interface FaultTrendSummary { total: number; open: number; resolved: number; mttr_min: number; affected_total: number; by_level: { level: string; count: number }[] }
export interface FaultTrend { days: number; points: FaultTrendPoint[]; summary: FaultTrendSummary }
