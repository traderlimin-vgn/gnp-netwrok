import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MapPin, Pencil, Plus, Power, PowerOff, Trash2, Unplug, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Dot, EmptyRow, Field, NSelect, PageHeader, Pager, Panel, SearchInput, StatusBadge } from "@/components/common";
import { ConfirmButton, FilterBar, KV, Modal, Tbl } from "@/components/kit";
import { apiDelete, apiGet, apiPost, apiPut, errMsg } from "@/lib/api";
import { can, CUSTOMER_STATUS, exportCsv, fmtBps, fmtDate, mapsUrl, rupiah, useMe } from "@/lib/format";
import { fmtUptime, rxTone, useAcsAction, WifiDialog } from "./Acs";
import type { AcsDevice, ActionResult, Customer, CustomerIn, CustomerSaveResult, Package, Paged, Router, User } from "@/lib/types";

const EMPTY: CustomerIn = {
  name: "", whatsapp: "", alt_phone: "", address: "", rt: "", rw: "", village: "", district: "", city: "Sidoarjo", province: "Jawa Timur",
  latitude: null, longitude: null, package_id: "", install_date: new Date().toISOString().slice(0, 10), due_day: 10, status: "active",
  technician_id: "", notes: "", router_id: "", pppoe_username: "", pppoe_password: "", service: "pppoe", comment: "", create_pppoe: true,
};
const STATUS_OPTS = Object.entries(CUSTOMER_STATUS).map(([value, label]) => ({ value, label }));

function toForm(c: Customer): CustomerIn {
  return {
    name: c.name, whatsapp: c.whatsapp, alt_phone: c.alt_phone, address: c.address, rt: c.rt, rw: c.rw, village: c.village, district: c.district,
    city: c.city, province: c.province, latitude: c.latitude, longitude: c.longitude, package_id: c.package_id, install_date: c.install_date,
    due_day: c.due_day, status: c.status as CustomerIn["status"], technician_id: c.technician_id, notes: c.notes, router_id: c.router_id,
    pppoe_username: c.pppoe_username, pppoe_password: "", service: c.service || "pppoe", comment: c.comment, create_pppoe: !c.mikrotik_id,
  };
}

export function useRefs() {
  const packages = useQuery({ queryKey: ["packages"], queryFn: () => apiGet<Package[]>("/packages") });
  const routers = useQuery({ queryKey: ["routers"], queryFn: () => apiGet<Router[]>("/mikrotik/routers"), retry: false });
  const techs = useQuery({ queryKey: ["technicians"], queryFn: () => apiGet<User[]>("/technicians") });
  return { packages: packages.data ?? [], routers: routers.data ?? [], techs: techs.data ?? [] };
}

function CustomerForm({ initial, editing, onClose }: { initial: CustomerIn; editing: Customer | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { packages, routers, techs } = useRefs();
  const [f, setF] = useState<CustomerIn>(initial);
  const set = <K extends keyof CustomerIn>(k: K, v: CustomerIn[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, latitude: f.latitude === null || Number.isNaN(f.latitude) ? null : f.latitude, longitude: f.longitude === null || Number.isNaN(f.longitude) ? null : f.longitude };
      return editing ? apiPut<CustomerSaveResult>(`/customers/${editing.id}`, body) : apiPost<CustomerSaveResult>("/customers", body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      const mt = r.mikrotik_result;
      if (mt === "FAILED") toast.warning(`Pelanggan tersimpan, namun MikroTik gagal (MIKROTIK_SYNC_FAILED): ${r.customer.integration_error}`);
      else if (mt === "PENDING") toast.warning("Pelanggan tersimpan. Router offline — aksi MikroTik masuk antrian retry.");
      else toast.success(`Pelanggan ${r.customer.customer_code} tersimpan${mt === "SUCCESS" ? " · MikroTik SUCCESS" : ""}`);
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const pkg = packages.find((p) => p.id === f.package_id);
  const numOrNull = (v: string) => (v === "" ? null : Number(v));
  return (
    <Modal open onClose={onClose} wide title={editing ? `Edit ${editing.customer_code}` : "Tambah Pelanggan"} testid="customer-form-dialog"
      footer={<>
        <Button variant="outline" onClick={onClose} data-testid="customer-form-cancel">Batal</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name || !f.whatsapp || !f.package_id} data-testid="customer-form-submit">{save.isPending ? "Menyimpan…" : "Simpan"}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nama pelanggan *" className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="customer-name-input" /></Field>
          <Field label="Status"><NSelect value={f.status} onChange={(v) => set("status", v as CustomerIn["status"])} options={STATUS_OPTS} testid="customer-status-select" /></Field>
          <Field label="No. WhatsApp *" hint="Format 628xxxx"><Input value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} data-testid="customer-whatsapp-input" /></Field>
          <Field label="No. alternatif"><Input value={f.alt_phone} onChange={(e) => set("alt_phone", e.target.value)} data-testid="customer-altphone-input" /></Field>
          <Field label="Teknisi"><NSelect value={f.technician_id} onChange={(v) => set("technician_id", v)} options={techs.map((t) => ({ value: t.id, label: t.name }))} placeholder="— Pilih —" testid="customer-technician-select" /></Field>
          <Field label="Alamat" className="sm:col-span-3"><Input value={f.address} onChange={(e) => set("address", e.target.value)} data-testid="customer-address-input" /></Field>
          <Field label="RT"><Input value={f.rt} onChange={(e) => set("rt", e.target.value)} data-testid="customer-rt-input" /></Field>
          <Field label="RW"><Input value={f.rw} onChange={(e) => set("rw", e.target.value)} data-testid="customer-rw-input" /></Field>
          <Field label="Desa/Kelurahan"><Input value={f.village} onChange={(e) => set("village", e.target.value)} data-testid="customer-village-input" /></Field>
          <Field label="Kecamatan"><Input value={f.district} onChange={(e) => set("district", e.target.value)} data-testid="customer-district-input" /></Field>
          <Field label="Kabupaten/Kota"><Input value={f.city} onChange={(e) => set("city", e.target.value)} data-testid="customer-city-input" /></Field>
          <Field label="Provinsi"><Input value={f.province} onChange={(e) => set("province", e.target.value)} data-testid="customer-province-input" /></Field>
          <Field label="Latitude"><Input type="number" step="any" value={f.latitude ?? ""} onChange={(e) => set("latitude", numOrNull(e.target.value))} data-testid="customer-lat-input" /></Field>
          <Field label="Longitude"><Input type="number" step="any" value={f.longitude ?? ""} onChange={(e) => set("longitude", numOrNull(e.target.value))} data-testid="customer-lng-input" /></Field>
          <Field label="Tanggal pasang"><Input type="date" value={f.install_date} onChange={(e) => set("install_date", e.target.value)} data-testid="customer-install-input" /></Field>
          <Field label="Paket internet *"><NSelect value={f.package_id} onChange={(v) => set("package_id", v)} options={packages.filter((p) => p.active || p.id === f.package_id).map((p) => ({ value: p.id, label: p.name }))} placeholder="— Pilih paket —" testid="customer-package-select" /></Field>
          <Field label="Harga paket"><Input readOnly value={pkg ? rupiah(pkg.price) : "-"} className="font-mono" data-testid="customer-price-display" /></Field>
          <Field label="Tgl jatuh tempo (1-28)"><Input type="number" min={1} max={28} value={f.due_day} onChange={(e) => set("due_day", Number(e.target.value))} data-testid="customer-dueday-input" /></Field>
          <Field label="Catatan" className="sm:col-span-3"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} data-testid="customer-notes-input" /></Field>
        </div>
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-sky-400">MikroTik PPPoE</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Router MikroTik"><NSelect value={f.router_id} onChange={(v) => set("router_id", v)} options={routers.map((r) => ({ value: r.id, label: `${r.name} (${r.status})` }))} placeholder="— Tidak terhubung —" testid="customer-router-select" /></Field>
            <Field label="PPPoE Username"><Input value={f.pppoe_username} onChange={(e) => set("pppoe_username", e.target.value)} className="font-mono" data-testid="customer-pppoe-username-input" /></Field>
            <Field label="PPPoE Password" hint={editing?.has_pppoe_password ? "Kosongkan jika tidak diubah" : undefined}><Input type="password" value={f.pppoe_password} onChange={(e) => set("pppoe_password", e.target.value)} data-testid="customer-pppoe-password-input" /></Field>
            <Field label="Profile"><Input readOnly value={pkg?.mikrotik_profile || "-"} className="font-mono" data-testid="customer-profile-display" /></Field>
            <Field label="Service"><NSelect value={f.service} onChange={(v) => set("service", v)} options={[{ value: "pppoe", label: "pppoe" }, { value: "any", label: "any" }]} testid="customer-service-select" /></Field>
            <Field label="Comment"><Input value={f.comment} onChange={(e) => set("comment", e.target.value)} data-testid="customer-comment-input" /></Field>
          </div>
          {(!editing || !editing.mikrotik_id) && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <Checkbox checked={f.create_pppoe} onCheckedChange={(v) => set("create_pppoe", !!v)} data-testid="customer-create-pppoe-checkbox" />
              Create PPPoE User on MikroTik
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}

function OntSection({ c }: { c: Customer }) {
  const { data: me } = useMe();
  const { data = [], isLoading, error } = useQuery({ queryKey: ["acs-devices", "customer", c.id], queryFn: () => apiGet<AcsDevice[]>(`/genieacs/devices?customer_id=${c.id}`), retry: false });
  const [wifi, setWifi] = useState<AcsDevice | null>(null);
  const act = useAcsAction();
  return (
    <div data-testid="customer-ont-section">
      <h4 className="mt-5 mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-400">ONT / GenieACS</h4>
      {isLoading && <div className="text-xs text-muted-foreground">Memuat…</div>}
      {error && <div className="text-xs text-red-300">{errMsg(error)}</div>}
      {!isLoading && !error && data.length === 0 && <div className="text-xs text-muted-foreground" data-testid="customer-ont-empty">Belum ada ONT terhubung (hubungkan di menu GenieACS / ONT)</div>}
      {data.map((d) => (
        <div key={d.id}>
          <KV k="Perangkat" v={`${d.manufacturer} ${d.model} · ${d.serial}`} mono />
          <KV k="Status" v={<span className="inline-flex items-center gap-2"><Dot status={d.status} />{d.status} · {fmtDate(d.last_inform, true)}</span>} />
          <KV k="RX / TX Power" v={<span className="font-mono"><b className={rxTone(d.rx_power)} data-testid="customer-ont-rx">{d.rx_power ?? "-"}</b> / {d.tx_power ?? "-"} dBm</span>} />
          <KV k="WiFi" v={`${d.ssid} · ${d.wifi_clients} klien`} mono /><KV k="Uptime ONT" v={fmtUptime(d.uptime)} mono />
          {can(me, "mikrotik.control") && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="xs" variant="outline" onClick={() => setWifi(d)} data-testid="customer-ont-wifi">Ganti WiFi</Button>
              <ConfirmButton label="Reboot ONT" title="Reboot ONT" message={`Reboot ${d.model} ${d.serial}? Internet pelanggan putus 1–2 menit.`} onConfirm={() => act.mutate({ id: d.id, action: "reboot" })} testid="customer-ont-reboot" />
            </div>
          )}
        </div>
      ))}
      {wifi && <WifiDialog d={wifi} onClose={() => setWifi(null)} />}
    </div>
  );
}

function CustomerDetail({ c, onClose, onEdit }: { c: Customer; onClose: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const act = useMutation({
    mutationFn: (a: string) => apiPost<ActionResult>(`/mikrotik/customers/${c.id}/${a}`),
    onSuccess: (r) => {
      (r.result === "SUCCESS" || r.result === "SKIPPED" ? toast.success : toast.warning)(`${r.result}: ${r.message}`);
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["pppoe"] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const ctl = can(me, "mikrotik.control") && !!c.router_id && !!c.pppoe_username;
  const actions: [string, string, React.ReactNode, string][] = [
    ["enable", "Enable PPPoE", <Power className="h-3.5 w-3.5" />, "Aktifkan PPP secret pelanggan ini?"],
    ["disable", "Disable PPPoE", <PowerOff className="h-3.5 w-3.5" />, "Nonaktifkan PPP secret pelanggan ini?"],
    ["disconnect", "Disconnect", <Unplug className="h-3.5 w-3.5" />, "Putus session PPPoE aktif pelanggan ini?"],
    ["isolate", "Isolir", <Lock className="h-3.5 w-3.5" />, "Isolir pelanggan sesuai metode isolasi di pengaturan?"],
    ["activate", "Aktifkan", <Unlock className="h-3.5 w-3.5" />, "Aktifkan kembali layanan pelanggan?"],
  ];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="customer-detail-sheet">
        <div className="p-5">
          <SheetTitle className="font-heading text-xl">{c.name}</SheetTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-sky-300">{c.customer_code}</span>
            <StatusBadge value={c.status} label={CUSTOMER_STATUS[c.status]} testid="customer-detail-status" />
            <StatusBadge value={c.integration_status} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {can(me, "customers.write") && <Button size="xs" onClick={onEdit} data-testid="customer-detail-edit"><Pencil className="h-3.5 w-3.5" />Edit</Button>}
            {mapsUrl(c.latitude, c.longitude) && <a href={mapsUrl(c.latitude, c.longitude)} target="_blank" rel="noreferrer" data-testid="customer-detail-maps"><Button size="xs" variant="outline"><MapPin className="h-3.5 w-3.5" />Google Maps</Button></a>}
          </div>
          <h4 className="mt-5 mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Data Pelanggan</h4>
          <KV k="WhatsApp" v={c.whatsapp} mono /><KV k="Alternatif" v={c.alt_phone} mono />
          <KV k="Alamat" v={`${c.address} RT ${c.rt}/RW ${c.rw}, ${c.village}, ${c.district}, ${c.city}, ${c.province}`} />
          <KV k="Koordinat" v={c.latitude != null ? `${c.latitude}, ${c.longitude}` : ""} mono />
          <KV k="Paket" v={`${c.package_name} · ${rupiah(c.package_price)}`} />
          <KV k="Tgl pasang" v={fmtDate(c.install_date)} /><KV k="Jatuh tempo" v={`Tanggal ${c.due_day}`} />
          <KV k="Teknisi" v={c.technician_name} /><KV k="Tagihan belum lunas" v={String(c.unpaid_count)} /><KV k="Catatan" v={c.notes} />
          <h4 className="mt-5 mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-sky-400">MikroTik</h4>
          <KV k="Router" v={c.router_name} /><KV k="PPPoE Username" v={c.pppoe_username} mono /><KV k="Profile" v={c.pppoe_profile} mono />
          <KV k="Service" v={c.service} /><KV k="MikroTik ID" v={c.mikrotik_id} mono />
          <KV k="Status koneksi" v={<span className="inline-flex items-center gap-2"><Dot status={c.connection_status} />{c.connection_status}{c.mikrotik_disabled && " · disabled"}</span>} />
          <KV k="IP Address" v={c.ip_address} mono /><KV k="MAC Address" v={c.mac_address} mono /><KV k="Interface" v={c.interface} mono />
          <KV k="Uptime" v={c.uptime} mono /><KV k="Last Online" v={fmtDate(c.last_online, true)} /><KV k="Last Offline" v={fmtDate(c.last_offline, true)} />
          <KV k="RX / TX" v={`${fmtBps(c.rx_bytes)} / ${fmtBps(c.tx_bytes)}`} mono /><KV k="Comment" v={c.comment} />
          {c.integration_error && <div className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-300" data-testid="customer-integration-error">{c.integration_error}</div>}
          {can(me, "mikrotik.view") && <OntSection c={c} />}
          {ctl && (
            <div className="mt-4 flex flex-wrap gap-2" data-testid="customer-mikrotik-actions">
              {actions.map(([a, label, icon, msg]) => (
                <ConfirmButton key={a} label={label} icon={icon} title={label} message={`${msg} (${c.pppoe_username})`} onConfirm={() => act.mutate(a)}
                  testid={`customer-action-${a}`} variant={a === "disable" || a === "isolate" || a === "disconnect" ? "destructive" : "outline"} disabled={act.isPending} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Customers() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { routers, packages } = useRefs();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [routerId, setRouterId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ initial: CustomerIn; editing: Customer | null } | null>(null);
  const [detail, setDetail] = useState<Customer | null>(null);
  const params = new URLSearchParams({ q, status, router_id: routerId, package_id: packageId, sort, page: String(page), limit: "20" });
  const { data, isLoading } = useQuery({ queryKey: ["customers", params.toString()], queryFn: () => apiGet<Paged<Customer>>(`/customers?${params}`) });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/customers/${id}?remove_pppoe=true`),
    onSuccess: () => { toast.success("Pelanggan dihapus"); qc.invalidateQueries({ queryKey: ["customers"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = data?.items ?? [];
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  return (
    <div>
      <PageHeader eyebrow="Operasional" title="Data Pelanggan" subtitle="Kelola pelanggan, paket, lokasi dan pemetaan PPPoE MikroTik."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => exportCsv("pelanggan.csv", rows as unknown as Record<string, unknown>[], ["customer_code", "name", "whatsapp", "address", "package_name", "status", "router_name", "pppoe_username", "ip_address", "connection_status"])} data-testid="customers-export-button"><Download className="h-4 w-4" />Export CSV</Button>
          {can(me, "customers.write") && <Button size="sm" onClick={() => setForm({ initial: EMPTY, editing: null })} data-testid="customers-add-button"><Plus className="h-4 w-4" />Tambah Pelanggan</Button>}
        </>} />
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={reset(setQ)} placeholder="Nama, WA, ID, PPPoE, alamat, IP, MAC…" testid="customers-search-input" />
          <NSelect value={status} onChange={reset(setStatus)} options={STATUS_OPTS} placeholder="Semua status" testid="customers-status-filter" />
          <NSelect value={routerId} onChange={reset(setRouterId)} options={routers.map((r) => ({ value: r.id, label: r.name }))} placeholder="Semua router" testid="customers-router-filter" />
          <NSelect value={packageId} onChange={reset(setPackageId)} options={packages.map((p) => ({ value: p.id, label: p.name }))} placeholder="Semua paket" testid="customers-package-filter" />
          <NSelect value={sort} onChange={setSort} options={[{ value: "newest", label: "Terbaru" }, { value: "name", label: "Nama A-Z" }, { value: "code", label: "Customer ID" }]} testid="customers-sort-select" />
        </FilterBar>
        <Tbl testid="customers-table" head={["Customer ID", "Pelanggan", "Paket", "Router / PPPoE", "Koneksi", "Status", "Integrasi", ""]}>
          {isLoading && <EmptyRow cols={8} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={8} />}
          {rows.map((c) => (
            <tr key={c.id} className="cursor-pointer" onClick={() => setDetail(c)} data-testid={`customer-row-${c.customer_code}`}>
              <td className="font-mono text-xs text-sky-300">{c.customer_code}</td>
              <td><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.whatsapp} · {c.village}</div></td>
              <td><div>{c.package_name}</div><div className="font-mono text-xs text-emerald-400">{rupiah(c.package_price)}</div></td>
              <td><div className="text-xs">{c.router_name || "-"}</div><div className="font-mono text-xs text-muted-foreground">{c.pppoe_username || "-"}</div></td>
              <td><span className="inline-flex items-center gap-2 text-xs"><Dot status={c.connection_status} />{c.ip_address || c.connection_status}</span></td>
              <td><StatusBadge value={c.status} label={CUSTOMER_STATUS[c.status]} />{c.unpaid_count > 0 && <span className="ml-1 text-[10px] text-red-400">{c.unpaid_count} tagihan</span>}</td>
              <td><StatusBadge value={c.integration_status} /></td>
              <td onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-right">
                {can(me, "customers.write") && <Button size="icon-xs" variant="ghost" onClick={() => setForm({ initial: toForm(c), editing: c })} data-testid={`customer-edit-${c.customer_code}`}><Pencil /></Button>}
                {can(me, "customers.delete") && <ConfirmButton label="" icon={<Trash2 className="h-3.5 w-3.5" />} variant="ghost" title="Hapus pelanggan"
                  message={`Hapus ${c.name} (${c.customer_code})? PPP secret di MikroTik juga akan dihapus.`} onConfirm={() => del.mutate(c.id)} testid={`customer-delete-${c.customer_code}`} />}
              </td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={20} onPage={setPage} testid="customers-pager" />
      </Panel>
      {form && <CustomerForm initial={form.initial} editing={form.editing} onClose={() => setForm(null)} />}
      {detail && <CustomerDetail c={detail} onClose={() => setDetail(null)} onEdit={() => { setForm({ initial: toForm(detail), editing: detail }); setDetail(null); }} />}
    </div>
  );
}
