import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, FilePlus2, MessageCircle, Pencil, ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyRow, Field, NSelect, PageHeader, Pager, Panel, SearchInput, StatusBadge } from "@/components/common";
import { ConfirmButton, FilterBar, Modal, Tbl } from "@/components/kit";
import { apiGet, apiPatch, apiPost, apiUpload, errMsg } from "@/lib/api";
import { can, exportCsv, fmtDate, INVOICE_STATUS, PAY_METHOD, rupiah, useMe } from "@/lib/format";
import type { AutomationResult, Invoice, InvoiceGenerateOut, Paged, Payment, PaymentIn, PayMethod } from "@/lib/types";

const thisPeriod = () => new Date().toISOString().slice(0, 7);

export function PayDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PaymentIn>({ invoice_id: inv.id, method: "cash", amount: inv.total, reference: "", note: "", proof_url: "", confirm: true });
  const [uploading, setUploading] = useState(false);
  const pay = useMutation({
    mutationFn: () => apiPost<Payment>("/payments", f),
    onSuccess: (p) => {
      toast.success(`${p.payment_no} tercatat${p.status === "confirmed" ? " · Invoice LUNAS, aktivasi MikroTik dijalankan" : " · menunggu konfirmasi"}`);
      ["invoices", "payments", "customers", "dashboard", "whatsapp"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try { const r = await apiUpload(file); setF((p) => ({ ...p, proof_url: r.url })); toast.success("Bukti diunggah"); }
    catch (e) { toast.error(errMsg(e)); } finally { setUploading(false); }
  };
  return (
    <Modal open onClose={onClose} title="Input Pembayaran" description={`${inv.invoice_no} · ${inv.customer_name} · ${rupiah(inv.total)}`} testid="pay-dialog"
      footer={<><Button variant="outline" onClick={onClose} data-testid="pay-cancel">Batal</Button>
        <Button onClick={() => pay.mutate()} disabled={pay.isPending || uploading || f.amount <= 0} data-testid="pay-submit">{pay.isPending ? "Memproses…" : "Simpan Pembayaran"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Metode"><NSelect value={f.method} onChange={(v) => setF({ ...f, method: v as PayMethod })} options={Object.entries(PAY_METHOD).map(([value, label]) => ({ value, label }))} testid="pay-method-select" /></Field>
        <Field label="Nominal (Rp)"><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} className="font-mono" data-testid="pay-amount-input" /></Field>
        <Field label="Referensi / No. transaksi"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} data-testid="pay-reference-input" /></Field>
        <Field label="Bukti pembayaran"><Input type="file" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files?.[0])} data-testid="pay-proof-input" /></Field>
        <Field label="Catatan" className="sm:col-span-2"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid="pay-note-input" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox checked={f.confirm} onCheckedChange={(v) => setF({ ...f, confirm: !!v })} data-testid="pay-confirm-checkbox" />Konfirmasi langsung (invoice LUNAS + auto aktivasi)</label>
      </div>
    </Modal>
  );
}

function AdjustDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const qc = useQueryClient();
  const [discount, setDiscount] = useState(inv.discount);
  const [penalty, setPenalty] = useState(inv.penalty);
  const save = useMutation({
    mutationFn: () => apiPatch<Invoice>(`/invoices/${inv.id}`, { discount, penalty }),
    onSuccess: () => { toast.success("Invoice diperbarui"); qc.invalidateQueries({ queryKey: ["invoices"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose} title={`Diskon & Denda — ${inv.invoice_no}`} testid="adjust-dialog"
      footer={<Button onClick={() => save.mutate()} data-testid="adjust-submit">Simpan</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Diskon (Rp)"><Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} data-testid="adjust-discount-input" /></Field>
        <Field label="Denda (Rp)"><Input type="number" value={penalty} onChange={(e) => setPenalty(Number(e.target.value))} data-testid="adjust-penalty-input" /></Field>
        <div className="font-mono text-sm sm:col-span-2">Total: <span className="text-emerald-400">{rupiah(inv.amount - discount + penalty)}</span></div>
      </div>
    </Modal>
  );
}

export default function Invoices() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [genOpen, setGenOpen] = useState(false);
  const [genPeriod, setGenPeriod] = useState(thisPeriod());
  const [payInv, setPayInv] = useState<Invoice | null>(null);
  const [adjInv, setAdjInv] = useState<Invoice | null>(null);
  const params = new URLSearchParams({ q, status, period, sort, page: String(page), limit: "20" });
  const { data, isLoading } = useQuery({ queryKey: ["invoices", params.toString()], queryFn: () => apiGet<Paged<Invoice>>(`/invoices?${params}`) });
  const inval = () => ["invoices", "dashboard", "customers"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const gen = useMutation({
    mutationFn: () => apiPost<InvoiceGenerateOut>("/invoices/generate", { period: genPeriod }),
    onSuccess: (r) => { toast.success(`Periode ${r.period}: ${r.created} invoice dibuat, ${r.skipped} dilewati. Notifikasi WhatsApp diantrikan.`); setGenOpen(false); inval(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const auto = useMutation({
    mutationFn: () => apiPost<AutomationResult>("/billing/run-automation"),
    onSuccess: (r) => { toast.success(`Overdue: ${r.overdue_marked} · Diisolir: ${r.isolated} · Dilewati: ${r.skipped}${r.auto_isolation ? "" : " (Auto isolation OFF)"}`); inval(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => apiPatch<Invoice>(`/invoices/${id}`, { status: "cancelled" }),
    onSuccess: () => { toast.success("Invoice dibatalkan"); inval(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remind = useMutation({
    mutationFn: (i: Invoice) => apiPost("/whatsapp/send", { to: i.whatsapp, name: i.customer_name, message:
      `Halo ${i.customer_name},\n\nTagihan internet Network GMP Anda:\n\nInvoice: ${i.invoice_no}\nPeriode: ${i.period}\nTotal: ${rupiah(i.total)}\nJatuh Tempo: ${fmtDate(i.due_date)}\n\nSilakan melakukan pembayaran sebelum tanggal jatuh tempo.\n\nTerima kasih.\nNETWORK GMP` }),
    onSuccess: () => toast.success("Pengingat tagihan dikirim via WhatsApp"),
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = data?.items ?? [];
  const bw = can(me, "billing.write");
  return (
    <div>
      <PageHeader eyebrow="Billing & Kas" title="Tagihan" subtitle="Generate tagihan bulanan otomatis, kelola diskon/denda, dan jalankan otomasi overdue → isolir."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => exportCsv("tagihan.csv", rows as unknown as Record<string, unknown>[], ["invoice_no", "customer_code", "customer_name", "period", "amount", "discount", "penalty", "total", "due_date", "status"])} data-testid="invoices-export-button"><Download className="h-4 w-4" />Export</Button>
          {bw && <ConfirmButton size="sm" label="Jalankan Otomasi Isolir" icon={<ShieldAlert className="h-4 w-4" />} title="Otomasi Billing → MikroTik"
            message="Tandai invoice melewati jatuh tempo menjadi OVERDUE dan isolir pelanggan yang melewati grace period (jika Auto Isolation ON)." onConfirm={() => auto.mutate()} testid="invoices-run-automation-button" />}
          {bw && <Button size="sm" onClick={() => setGenOpen(true)} data-testid="invoices-generate-button"><FilePlus2 className="h-4 w-4" />Generate Tagihan</Button>}
        </>} />
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="No. invoice, pelanggan, WA…" testid="invoices-search-input" />
          <NSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={Object.entries(INVOICE_STATUS).map(([value, label]) => ({ value, label }))} placeholder="Semua status" testid="invoices-status-filter" />
          <Input type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setPage(1); }} className="w-40" data-testid="invoices-period-filter" />
          <NSelect value={sort} onChange={setSort} options={[{ value: "newest", label: "Terbaru" }, { value: "due", label: "Jatuh tempo" }, { value: "total", label: "Nominal terbesar" }]} testid="invoices-sort-select" />
        </FilterBar>
        <Tbl testid="invoices-table" head={["Invoice", "Pelanggan", "Periode", "Nominal", "Diskon/Denda", "Total", "Jatuh tempo", "Status", ""]}>
          {isLoading && <EmptyRow cols={9} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={9} />}
          {rows.map((i) => (
            <tr key={i.id} data-testid={`invoice-row-${i.invoice_no}`}>
              <td className="font-mono text-xs text-sky-300">{i.invoice_no}</td>
              <td><div className="font-medium">{i.customer_name}</div><div className="text-xs text-muted-foreground">{i.customer_code} · {i.package_name}</div></td>
              <td className="font-mono text-xs">{i.period}</td>
              <td className="font-mono text-xs">{rupiah(i.amount)}</td>
              <td className="font-mono text-xs text-muted-foreground">-{rupiah(i.discount)} / +{rupiah(i.penalty)}</td>
              <td className="font-mono text-sm font-bold text-emerald-400">{rupiah(i.total)}</td>
              <td className="text-xs">{fmtDate(i.due_date)}</td>
              <td><StatusBadge value={i.status} label={INVOICE_STATUS[i.status]} testid={`invoice-status-${i.invoice_no}`} /></td>
              <td className="whitespace-nowrap text-right">
                {(i.status === "unpaid" || i.status === "overdue") && <>
                  {can(me, "payments.write") && <Button size="xs" onClick={() => setPayInv(i)} data-testid={`invoice-pay-${i.invoice_no}`}><Wallet className="h-3.5 w-3.5" />Bayar</Button>}
                  {can(me, "whatsapp.send") && <Button size="icon-xs" variant="ghost" title="Kirim tagihan WA" onClick={() => remind.mutate(i)} data-testid={`invoice-remind-${i.invoice_no}`}><MessageCircle /></Button>}
                  {bw && <Button size="icon-xs" variant="ghost" title="Diskon/denda" onClick={() => setAdjInv(i)} data-testid={`invoice-adjust-${i.invoice_no}`}><Pencil /></Button>}
                  {bw && <ConfirmButton label="" icon={<Ban className="h-3.5 w-3.5" />} variant="ghost" title="Batalkan invoice" message={`Batalkan ${i.invoice_no}?`} onConfirm={() => cancel.mutate(i.id)} testid={`invoice-cancel-${i.invoice_no}`} />}
                </>}
                {i.status === "paid" && <span className="text-xs text-muted-foreground">{fmtDate(i.paid_at, true)}</span>}
              </td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={20} onPage={setPage} testid="invoices-pager" />
      </Panel>
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generate Tagihan Bulanan" description="Membuat invoice untuk semua pelanggan aktif/isolir. Aman dijalankan berulang (idempotent per periode)." testid="generate-dialog"
        footer={<Button onClick={() => gen.mutate()} disabled={gen.isPending} data-testid="generate-submit">{gen.isPending ? "Memproses…" : "Generate"}</Button>}>
        <Field label="Periode"><Input type="month" value={genPeriod} onChange={(e) => setGenPeriod(e.target.value)} data-testid="generate-period-input" /></Field>
      </Modal>
      {payInv && <PayDialog inv={payInv} onClose={() => setPayInv(null)} />}
      {adjInv && <AdjustDialog inv={adjInv} onClose={() => setAdjInv(null)} />}
    </div>
  );
}
