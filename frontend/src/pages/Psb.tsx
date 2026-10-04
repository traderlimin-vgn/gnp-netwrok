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
import { can, exportCsv, fmtDate, mapsUrl, PSB_STATUS, useMe } from "@/lib/format";
import type { Package, Paged, Psb, PsbIn, PsbUpdate, User } from "@/lib/types";

const STATUS_OPTS = Object.entries(PSB_STATUS).map(([value, label]) => ({ value, label }));

function NewPsb({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: pkgs = [] } = useQuery({ queryKey: ["packages"], queryFn: () => apiGet<Package[]>("/packages") });
  const { data: techs = [] } = useQuery({ queryKey: ["technicians"], queryFn: () => apiGet<User[]>("/technicians") });
  const [f, setF] = useState<PsbIn>({ name: "", whatsapp: "", address: "", rt: "", rw: "", latitude: null, longitude: null, package_id: "", technician_id: "", schedule: "", notes: "" });
  const nn = (v: string) => (v === "" ? null : Number(v));
  const save = useMutation({
    mutationFn: () => apiPost<Psb>("/psb", f),
    onSuccess: (p) => { toast.success(`${p.psb_no} dibuat${p.technician_name ? ` · WhatsApp ke ${p.technician_name}` : ""}`); qc.invalidateQueries({ queryKey: ["psb"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose} wide title="PSB — Pasang Baru" testid="psb-form-dialog"
      footer={<Button onClick={() => save.mutate()} disabled={!f.name || !f.whatsapp || !f.package_id || save.isPending} data-testid="psb-form-submit">Buat PSB</Button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nama *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="psb-name-input" /></Field>
        <Field label="WhatsApp *"><Input value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="628…" data-testid="psb-whatsapp-input" /></Field>
        <Field label="Paket *"><NSelect value={f.package_id} onChange={(v) => setF({ ...f, package_id: v })} options={pkgs.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))} placeholder="— Pilih —" testid="psb-package-select" /></Field>
        <Field label="Alamat" className="sm:col-span-3"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="psb-address-input" /></Field>
        <Field label="RT"><Input value={f.rt} onChange={(e) => setF({ ...f, rt: e.target.value })} data-testid="psb-rt-input" /></Field>
        <Field label="RW"><Input value={f.rw} onChange={(e) => setF({ ...f, rw: e.target.value })} data-testid="psb-rw-input" /></Field>
        <Field label="Jadwal"><Input type="datetime-local" value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} data-testid="psb-schedule-input" /></Field>
        <Field label="Latitude"><Input type="number" step="any" value={f.latitude ?? ""} onChange={(e) => setF({ ...f, latitude: nn(e.target.value) })} data-testid="psb-lat-input" /></Field>
        <Field label="Longitude"><Input type="number" step="any" value={f.longitude ?? ""} onChange={(e) => setF({ ...f, longitude: nn(e.target.value) })} data-testid="psb-lng-input" /></Field>
        <Field label="Teknisi"><NSelect value={f.technician_id} onChange={(v) => setF({ ...f, technician_id: v })} options={techs.map((t) => ({ value: t.id, label: t.name }))} placeholder="— Belum —" testid="psb-technician-select" /></Field>
        <Field label="Catatan" className="sm:col-span-3"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="psb-notes-input" /></Field>
      </div>
    </Modal>
  );
}

export function PsbEdit({ p, onClose }: { p: Psb; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: techs = [] } = useQuery({ queryKey: ["technicians"], queryFn: () => apiGet<User[]>("/technicians") });
  const [f, setF] = useState<PsbUpdate>({ status: p.status, technician_id: p.technician_id, schedule: p.schedule, notes: p.notes });
  const [busy, setBusy] = useState(false);
  const isTech = me?.role === "teknisi";
  const save = useMutation({
    mutationFn: () => apiPatch<Psb>(`/psb/${p.id}`, isTech ? { status: f.status, notes: f.notes } : f),
    onSuccess: (r) => {
      toast.success(r.status === "done" && r.customer_id ? "PSB selesai · pelanggan otomatis dibuat" : "PSB diperbarui");
      ["psb", "technician-board", "customers"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const photo = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try { const r = await apiUpload(file); await apiPatch(`/psb/${p.id}`, { photo_url: r.url }); toast.success("Foto diunggah"); qc.invalidateQueries({ queryKey: ["psb"] }); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${p.psb_no} — ${p.name}`} description={`${p.address} · ${p.package_name}`} testid="psb-edit-dialog"
      footer={<Button onClick={() => save.mutate()} disabled={save.isPending || busy} data-testid="psb-edit-submit">Simpan</Button>}>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status"><NSelect value={f.status ?? ""} onChange={(v) => setF({ ...f, status: v })} options={STATUS_OPTS} testid="psb-edit-status-select" /></Field>
          {!isTech && <Field label="Jadwal"><Input type="datetime-local" value={f.schedule ?? ""} onChange={(e) => setF({ ...f, schedule: e.target.value })} data-testid="psb-edit-schedule-input" /></Field>}
        </div>
        {!isTech && <Field label="Teknisi"><NSelect value={f.technician_id ?? ""} onChange={(v) => setF({ ...f, technician_id: v })} options={techs.map((t) => ({ value: t.id, label: t.name }))} placeholder="— Belum —" testid="psb-edit-technician-select" /></Field>}
        <Field label="Catatan"><Textarea rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="psb-edit-notes-input" /></Field>
        <Field label="Upload foto"><Input type="file" accept="image/*" capture="environment" onChange={(e) => photo(e.target.files?.[0])} data-testid="psb-edit-photo-input" /></Field>
      </div>
    </Modal>
  );
}

export default function PsbPage() {
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<Psb | null>(null);
  const params = new URLSearchParams({ q, status, page: String(page), limit: "20" });
  const { data, isLoading } = useQuery({ queryKey: ["psb", params.toString()], queryFn: () => apiGet<Paged<Psb>>(`/psb?${params}`) });
  const rows = data?.items ?? [];
  return (
    <div>
      <PageHeader eyebrow="Lapangan" title="PSB — Pasang Baru" subtitle="Calon pelanggan → jadwal → teknisi (notifikasi WhatsApp) → selesai."
        actions={<>
          <Button size="sm" variant="outline" onClick={() => exportCsv("psb.csv", rows as unknown as Record<string, unknown>[], ["psb_no", "name", "whatsapp", "address", "package_name", "technician_name", "schedule", "status"])} data-testid="psb-export-button"><Download className="h-4 w-4" />Export</Button>
          {can(me, "psb.write") && <Button size="sm" onClick={() => setAdding(true)} data-testid="psb-add-button"><Plus className="h-4 w-4" />PSB Baru</Button>}
        </>} />
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="No. PSB, nama, WA, alamat…" testid="psb-search-input" />
          <NSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTS} placeholder="Semua status" testid="psb-status-filter" />
        </FilterBar>
        <Tbl testid="psb-table" head={["No. PSB", "Calon Pelanggan", "Alamat", "Paket", "Teknisi", "Jadwal", "Status", ""]}>
          {isLoading && <EmptyRow cols={8} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={8} />}
          {rows.map((p) => (
            <tr key={p.id} data-testid={`psb-row-${p.psb_no}`}>
              <td className="font-mono text-xs text-sky-300">{p.psb_no}</td>
              <td><div className="font-medium">{p.name}</div><div className="font-mono text-xs text-muted-foreground">{p.whatsapp}</div></td>
              <td className="text-xs">{p.address} {p.rt && `RT ${p.rt}/RW ${p.rw}`}</td>
              <td className="text-xs">{p.package_name}</td>
              <td className="text-xs">{p.technician_name || "-"}</td>
              <td className="whitespace-nowrap text-xs">{fmtDate(p.schedule, true)}</td>
              <td><StatusBadge value={p.status} label={PSB_STATUS[p.status]} testid={`psb-status-${p.psb_no}`} /></td>
              <td className="whitespace-nowrap text-right">
                {mapsUrl(p.latitude, p.longitude) && <a href={mapsUrl(p.latitude, p.longitude)} target="_blank" rel="noreferrer"><Button size="icon-xs" variant="ghost" data-testid={`psb-maps-${p.psb_no}`}><MapPin /></Button></a>}
                {(can(me, "psb.write") || me?.role === "teknisi") && <Button size="icon-xs" variant="ghost" onClick={() => setEdit(p)} data-testid={`psb-edit-${p.psb_no}`}><Pencil /></Button>}
              </td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={20} onPage={setPage} testid="psb-pager" />
      </Panel>
      {adding && <NewPsb onClose={() => setAdding(false)} />}
      {edit && <PsbEdit p={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
