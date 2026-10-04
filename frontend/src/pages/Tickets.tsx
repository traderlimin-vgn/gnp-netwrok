import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MapPin, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyRow, Field, NSelect, PageHeader, Pager, Panel, SearchInput, StatusBadge } from "@/components/common";
import { FilterBar, Modal, Tbl } from "@/components/kit";
import { apiGet, apiPatch, apiPost, apiUpload, errMsg } from "@/lib/api";
import { can, exportCsv, fmtDate, mapsUrl, PRIORITY, TICKET_STATUS, useMe } from "@/lib/format";
import type { Customer, Paged, Ticket, TicketIn, TicketUpdate, User } from "@/lib/types";

const opts = (r: Record<string, string>) => Object.entries(r).map(([value, label]) => ({ value, label }));

function NewTicket({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [cq, setCq] = useState("");
  const [f, setF] = useState<TicketIn>({ customer_id: "", complaint: "", priority: "medium", technician_id: "", notes: "" });
  const { data: custs } = useQuery({ queryKey: ["customers", "pick", cq], queryFn: () => apiGet<Paged<Customer>>(`/customers?q=${encodeURIComponent(cq)}&limit=20`) });
  const { data: techs = [] } = useQuery({ queryKey: ["technicians"], queryFn: () => apiGet<User[]>("/technicians") });
  const save = useMutation({
    mutationFn: () => apiPost<Ticket>("/tickets", f),
    onSuccess: (t) => { toast.success(`${t.ticket_no} dibuat${t.technician_name ? ` · WhatsApp ke ${t.technician_name} terkirim` : ""}`); qc.invalidateQueries({ queryKey: ["tickets"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose} title="Tiket Gangguan Baru" testid="ticket-form-dialog"
      footer={<Button onClick={() => save.mutate()} disabled={!f.customer_id || !f.complaint || save.isPending} data-testid="ticket-form-submit">Buat Tiket</Button>}>
      <div className="grid gap-3">
        <Field label="Cari pelanggan"><Input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Nama / ID / WA" data-testid="ticket-customer-search" /></Field>
        <Field label="Pelanggan *"><NSelect value={f.customer_id} onChange={(v) => setF({ ...f, customer_id: v })} options={(custs?.items ?? []).map((c) => ({ value: c.id, label: `${c.customer_code} · ${c.name}` }))} placeholder="— Pilih pelanggan —" testid="ticket-customer-select" /></Field>
        <Field label="Keluhan *"><Textarea rows={3} value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} data-testid="ticket-complaint-input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prioritas"><NSelect value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={opts(PRIORITY)} testid="ticket-priority-select" /></Field>
          <Field label="Teknisi" hint="Kosong = teknisi pelanggan"><NSelect value={f.technician_id} onChange={(v) => setF({ ...f, technician_id: v })} options={techs.map((t) => ({ value: t.id, label: t.name }))} placeholder="— Otomatis —" testid="ticket-technician-select" /></Field>
        </div>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="ticket-notes-input" /></Field>
      </div>
    </Modal>
  );
}

export function TicketEdit({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: techs = [] } = useQuery({ queryKey: ["technicians"], queryFn: () => apiGet<User[]>("/technicians") });
  const [f, setF] = useState<TicketUpdate>({ status: t.status, technician_id: t.technician_id, priority: t.priority, notes: t.notes });
  const [busy, setBusy] = useState(false);
  const save = useMutation({
    mutationFn: (body: TicketUpdate) => apiPatch<Ticket>(`/tickets/${t.id}`, body),
    onSuccess: () => { toast.success("Tiket diperbarui"); qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["technician-board"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const photo = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try { const r = await apiUpload(file); await apiPatch(`/tickets/${t.id}`, { photo_url: r.url }); toast.success("Foto diunggah"); qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["technician-board"] }); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const isTech = me?.role === "teknisi";
  return (
    <Modal open onClose={onClose} title={`${t.ticket_no} — ${t.customer_name}`} description={t.complaint} testid="ticket-edit-dialog"
      footer={<Button onClick={() => save.mutate(isTech ? { status: f.status, notes: f.notes } : f)} disabled={save.isPending || busy} data-testid="ticket-edit-submit">Simpan</Button>}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status"><NSelect value={f.status ?? ""} onChange={(v) => setF({ ...f, status: v })} options={opts(TICKET_STATUS)} testid="ticket-edit-status-select" /></Field>
          <Field label="Prioritas"><NSelect value={f.priority ?? ""} onChange={(v) => setF({ ...f, priority: v })} options={opts(PRIORITY)} testid="ticket-edit-priority-select" /></Field>
        </div>
        {!isTech && <Field label="Teknisi"><NSelect value={f.technician_id ?? ""} onChange={(v) => setF({ ...f, technician_id: v })} options={techs.map((x) => ({ value: x.id, label: x.name }))} placeholder="— Belum ditugaskan —" testid="ticket-edit-technician-select" /></Field>}
        <Field label="Catatan"><Textarea rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="ticket-edit-notes-input" /></Field>
        <Field label="Upload foto"><Input type="file" accept="image/*" capture="environment" onChange={(e) => photo(e.target.files?.[0])} data-testid="ticket-edit-photo-input" /></Field>
        {t.photos.length > 0 && <div className="flex flex-wrap gap-2">{t.photos.map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt="foto" className="h-16 w-16 rounded object-cover" /></a>)}</div>}
      </div>
    </Modal>
  );
}

export default function Tickets() {
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Ticket | null>(null);
  const params = new URLSearchParams({ q, status, priority, page: String(page), limit: "20" });
  const { data, isLoading } = useQuery({ queryKey: ["tickets", params.toString()], queryFn: () => apiGet<Paged<Ticket>>(`/tickets?${params}`) });
  const rows = data?.items ?? [];
  return (
    <div>
      <PageHeader eyebrow="Lapangan" title="Tiket Gangguan" subtitle="Laporan gangguan pelanggan → teknisi mendapat notifikasi WhatsApp lengkap dengan link Google Maps."
        actions={<>
          <Button size="sm" variant="outline" onClick={() => exportCsv("tiket.csv", rows as unknown as Record<string, unknown>[], ["ticket_no", "customer_name", "whatsapp", "complaint", "priority", "technician_name", "status", "reported_at", "resolved_at"])} data-testid="tickets-export-button"><Download className="h-4 w-4" />Export</Button>
          {can(me, "tickets.write") && me?.role !== "teknisi" && <Button size="sm" onClick={() => setAdding(true)} data-testid="tickets-add-button"><Plus className="h-4 w-4" />Tiket Baru</Button>}
        </>} />
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="No. tiket, pelanggan, keluhan…" testid="tickets-search-input" />
          <NSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={opts(TICKET_STATUS)} placeholder="Semua status" testid="tickets-status-filter" />
          <NSelect value={priority} onChange={(v) => { setPriority(v); setPage(1); }} options={opts(PRIORITY)} placeholder="Semua prioritas" testid="tickets-priority-filter" />
        </FilterBar>
        <Tbl testid="tickets-table" head={["No. Tiket", "Pelanggan", "Keluhan", "Prioritas", "Teknisi", "Status", "Dilaporkan", "Selesai", ""]}>
          {isLoading && <EmptyRow cols={9} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={9} />}
          {rows.map((t) => (
            <tr key={t.id} data-testid={`ticket-row-${t.ticket_no}`}>
              <td className="font-mono text-xs text-sky-300">{t.ticket_no}</td>
              <td><div className="font-medium">{t.customer_name}</div><div className="text-xs text-muted-foreground">{t.whatsapp} · {t.address}</div></td>
              <td className="max-w-xs text-xs">{t.complaint}</td>
              <td><StatusBadge value={t.priority} label={PRIORITY[t.priority]} /></td>
              <td className="text-xs">{t.technician_name || "-"}</td>
              <td><StatusBadge value={t.status} label={TICKET_STATUS[t.status]} testid={`ticket-status-${t.ticket_no}`} /></td>
              <td className="whitespace-nowrap text-xs">{fmtDate(t.reported_at, true)}</td>
              <td className="whitespace-nowrap text-xs">{fmtDate(t.resolved_at, true)}</td>
              <td className="whitespace-nowrap text-right">
                {mapsUrl(t.latitude, t.longitude) && <a href={mapsUrl(t.latitude, t.longitude)} target="_blank" rel="noreferrer"><Button size="icon-xs" variant="ghost" data-testid={`ticket-maps-${t.ticket_no}`}><MapPin /></Button></a>}
                {can(me, "tickets.write") && <Button size="icon-xs" variant="ghost" onClick={() => setEdit(t)} data-testid={`ticket-edit-${t.ticket_no}`}><Pencil /></Button>}
              </td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={20} onPage={setPage} testid="tickets-pager" />
      </Panel>
      {adding && <NewTicket onClose={() => setAdding(false)} />}
      {edit && <TicketEdit t={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
