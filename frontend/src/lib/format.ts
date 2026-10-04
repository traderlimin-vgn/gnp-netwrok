import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { Me, Role } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin", admin: "Admin", finance: "Finance", cs: "CS", teknisi: "Teknisi", supervisor: "Supervisor",
};

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiGet<Me>("/auth/me"), retry: false, staleTime: 60_000 });
}

export function can(me: Me | undefined, perm: string): boolean {
  return !!me?.permissions.includes(perm);
}

const rp = new Intl.NumberFormat("id-ID");
export const rupiah = (n: number) => `Rp ${rp.format(Math.round(n || 0))}`;
export const num = (n: number) => rp.format(n || 0);

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "-";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtBps(bps: number): string {
  if (!bps) return "0";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${(bps / 1000).toFixed(0)} kbps`;
}

export function mapsUrl(lat: number | null, lng: number | null) {
  return lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : "";
}

export function waUrl(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/** Client-side CSV export of the rows currently displayed. */
export function exportCsv(filename: string, rows: Record<string, unknown>[], cols: string[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

export const CUSTOMER_STATUS: Record<string, string> = {
  active: "Aktif", suspend: "Suspend", isolir: "Isolir", stopped: "Berhenti", pending: "Pending",
};
export const INVOICE_STATUS: Record<string, string> = { unpaid: "Belum Bayar", paid: "Lunas", overdue: "Terlambat", cancelled: "Dibatalkan" };
export const PAY_METHOD: Record<string, string> = { cash: "Tunai", transfer: "Transfer Bank", ewallet: "E-Wallet / QRIS", gateway: "Payment Gateway" };
export const TICKET_STATUS: Record<string, string> = { open: "Baru", assigned: "Ditugaskan", in_progress: "Dikerjakan", resolved: "Selesai", closed: "Ditutup" };
export const PRIORITY: Record<string, string> = { low: "Rendah", medium: "Sedang", high: "Tinggi", critical: "Kritis" };
export const PSB_STATUS: Record<string, string> = { new: "Baru", scheduled: "Terjadwal", installing: "Pemasangan", done: "Selesai", cancelled: "Batal" };
