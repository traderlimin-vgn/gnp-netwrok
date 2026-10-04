import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, MessageCircle, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyRow, NSelect, PageHeader, Pager, Panel, SearchInput, StatusBadge } from "@/components/common";
import { FilterBar, Modal, Tbl } from "@/components/kit";
import { apiGet, apiPost, errMsg } from "@/lib/api";
import { can, exportCsv, fmtDate, PAY_METHOD, rupiah, useMe } from "@/lib/format";
import type { Paged, Payment, Settings } from "@/lib/types";

function Receipt({ p, onClose }: { p: Payment; onClose: () => void }) {
  const { data: s } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/settings") });
  return (
    <Modal open onClose={onClose} title="Kwitansi Pembayaran" testid="receipt-dialog"
      footer={<Button onClick={() => window.print()} data-testid="receipt-print-button"><Printer className="h-4 w-4" />Cetak</Button>}>
      <div className="print-area relative overflow-hidden rounded-lg border border-slate-300 bg-white p-6 text-slate-900" data-testid="receipt-content">
        <div className="flex items-start justify-between border-b border-slate-300 pb-3">
          <div>
            <div className="font-heading text-xl font-bold text-sky-700">{s?.company_name || "NETWORK GMP"}</div>
            <div className="text-xs text-slate-500">{s?.company_address}</div>
            <div className="text-xs text-slate-500">{s?.company_phone}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Kwitansi</div>
            <div className="font-mono text-sm font-bold">{p.payment_no}</div>
          </div>
        </div>
        <div className="mt-4 space-y-1.5 text-sm">
          {[["Diterima dari", `${p.customer_name} (${p.customer_code})`], ["Invoice", p.invoice_no], ["Periode", p.period], ["Metode", PAY_METHOD[p.method]],
            ["Referensi", p.reference || "-"], ["Tanggal", fmtDate(p.paid_at, true)], ["Petugas", p.received_by]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v}</span></div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-md bg-slate-100 px-3 py-2">
          <span className="text-sm text-slate-600">Total dibayar</span>
          <span className="font-mono text-xl font-bold">{rupiah(p.amount)}</span>
        </div>
        {p.status === "confirmed" && <div className="pointer-events-none absolute bottom-6 right-6 rotate-[-12deg] rounded-md border-4 border-emerald-600 px-3 py-1 font-heading text-2xl font-black tracking-widest text-emerald-600 opacity-80">LUNAS</div>}
        <p className="mt-6 text-center text-xs text-slate-500">Terima kasih telah menggunakan layanan NETWORK GMP.</p>
      </div>
    </Modal>
  );
}

export default function Payments() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const params = new URLSearchParams({ q, method, status, page: String(page), limit: "20" });
  const { data, isLoading } = useQuery({ queryKey: ["payments", params.toString()], queryFn: () => apiGet<Paged<Payment>>(`/payments?${params}`) });
  const confirm = useMutation({
    mutationFn: (id: string) => apiPost<Payment>(`/payments/${id}/confirm`),
    onSuccess: () => { toast.success("Pembayaran dikonfirmasi · invoice LUNAS"); ["payments", "invoices", "customers", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const sendWa = useMutation({
    mutationFn: (p: Payment) => apiPost("/whatsapp/send", { to: p.whatsapp, name: p.customer_name, message:
      `Pembayaran Anda telah diterima.\n\nInvoice: ${p.invoice_no}\nKwitansi: ${p.payment_no}\nTotal: ${rupiah(p.amount)}\nStatus: LUNAS\n\nTerima kasih.\nNETWORK GMP` }),
    onSuccess: () => toast.success("Bukti pembayaran dikirim via WhatsApp"),
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = data?.items ?? [];
  return (
    <div>
      <PageHeader eyebrow="Billing & Kas" title="Pembayaran" subtitle="Riwayat pembayaran tunai, transfer, e-wallet & payment gateway. Input pembayaran dilakukan dari menu Tagihan."
        actions={<Button variant="outline" size="sm" onClick={() => exportCsv("pembayaran.csv", rows as unknown as Record<string, unknown>[], ["payment_no", "invoice_no", "customer_code", "customer_name", "amount", "method", "reference", "status", "paid_at"])} data-testid="payments-export-button"><Download className="h-4 w-4" />Export</Button>} />
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="No. pembayaran, invoice, pelanggan…" testid="payments-search-input" />
          <NSelect value={method} onChange={(v) => { setMethod(v); setPage(1); }} options={Object.entries(PAY_METHOD).map(([value, label]) => ({ value, label }))} placeholder="Semua metode" testid="payments-method-filter" />
          <NSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "confirmed", label: "Terkonfirmasi" }, { value: "pending", label: "Menunggu" }]} placeholder="Semua status" testid="payments-status-filter" />
        </FilterBar>
        <Tbl testid="payments-table" head={["No. Pembayaran", "Pelanggan", "Invoice", "Metode", "Nominal", "Tanggal", "Status", ""]}>
          {isLoading && <EmptyRow cols={8} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={8} />}
          {rows.map((p) => (
            <tr key={p.id} data-testid={`payment-row-${p.payment_no}`}>
              <td className="font-mono text-xs text-sky-300">{p.payment_no}</td>
              <td><div className="font-medium">{p.customer_name}</div><div className="text-xs text-muted-foreground">{p.customer_code}</div></td>
              <td className="font-mono text-xs">{p.invoice_no}</td>
              <td className="text-xs">{PAY_METHOD[p.method]}{p.proof_url && <a href={p.proof_url} target="_blank" rel="noreferrer" className="ml-1 text-sky-400 underline" data-testid={`payment-proof-${p.payment_no}`}>bukti</a>}</td>
              <td className="font-mono text-sm font-bold text-emerald-400">{rupiah(p.amount)}</td>
              <td className="text-xs">{fmtDate(p.paid_at, true)}</td>
              <td><StatusBadge value={p.status} label={p.status === "confirmed" ? "Terkonfirmasi" : "Menunggu"} /></td>
              <td className="whitespace-nowrap text-right">
                {p.status === "pending" && can(me, "payments.write") && <Button size="xs" onClick={() => confirm.mutate(p.id)} data-testid={`payment-confirm-${p.payment_no}`}><CheckCircle2 className="h-3.5 w-3.5" />Konfirmasi</Button>}
                <Button size="icon-xs" variant="ghost" title="Kwitansi" onClick={() => setReceipt(p)} data-testid={`payment-receipt-${p.payment_no}`}><Printer /></Button>
                {can(me, "whatsapp.send") && p.status === "confirmed" && <Button size="icon-xs" variant="ghost" title="Kirim WA" onClick={() => sendWa.mutate(p)} data-testid={`payment-wa-${p.payment_no}`}><MessageCircle /></Button>}
              </td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={20} onPage={setPage} testid="payments-pager" />
      </Panel>
      {receipt && <Receipt p={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
