import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, PageHeader, StatusBadge } from "@/components/common";
import { ConfirmButton, Modal } from "@/components/kit";
import { apiDelete, apiGet, apiPost, apiPut, errMsg } from "@/lib/api";
import { can, rupiah, useMe } from "@/lib/format";
import type { Package, PackageIn } from "@/lib/types";

const EMPTY: PackageIn = { name: "", speed: "", price: 0, upload: "", download: "", fup: "Unlimited", description: "", active: true, mikrotik_profile: "" };

function PackageForm({ editing, onClose }: { editing: Package | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PackageIn>(editing ? { ...editing } : EMPTY);
  const set = <K extends keyof PackageIn>(k: K, v: PackageIn[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body: PackageIn = { name: f.name, speed: f.speed, price: f.price, upload: f.upload, download: f.download, fup: f.fup, description: f.description, active: f.active, mikrotik_profile: f.mikrotik_profile };
      return editing ? apiPut<Package>(`/packages/${editing.id}`, body) : apiPost<Package>("/packages", body);
    },
    onSuccess: () => { toast.success("Paket tersimpan"); qc.invalidateQueries({ queryKey: ["packages"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose} title={editing ? "Edit Paket" : "Tambah Paket"} testid="package-form-dialog"
      footer={<><Button variant="outline" onClick={onClose} data-testid="package-form-cancel">Batal</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name} data-testid="package-form-submit">Simpan</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama paket" className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="GMP HOME 20 Mbps" data-testid="package-name-input" /></Field>
        <Field label="Kecepatan"><Input value={f.speed} onChange={(e) => set("speed", e.target.value)} placeholder="20 Mbps" data-testid="package-speed-input" /></Field>
        <Field label="Harga (Rp)"><Input type="number" value={f.price} onChange={(e) => set("price", Number(e.target.value))} data-testid="package-price-input" /></Field>
        <Field label="Upload"><Input value={f.upload} onChange={(e) => set("upload", e.target.value)} placeholder="10M" data-testid="package-upload-input" /></Field>
        <Field label="Download"><Input value={f.download} onChange={(e) => set("download", e.target.value)} placeholder="20M" data-testid="package-download-input" /></Field>
        <Field label="FUP"><Input value={f.fup} onChange={(e) => set("fup", e.target.value)} data-testid="package-fup-input" /></Field>
        <Field label="MikroTik PPP Profile"><Input value={f.mikrotik_profile} onChange={(e) => set("mikrotik_profile", e.target.value)} placeholder="GMP-HOME-20M" className="font-mono" data-testid="package-profile-input" /></Field>
        <Field label="Deskripsi" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} data-testid="package-description-input" /></Field>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.active} onCheckedChange={(v) => set("active", !!v)} data-testid="package-active-checkbox" />Paket aktif</label>
      </div>
    </Modal>
  );
}

export default function Packages() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data = [] } = useQuery({ queryKey: ["packages"], queryFn: () => apiGet<Package[]>("/packages") });
  const [form, setForm] = useState<{ editing: Package | null } | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/packages/${id}`),
    onSuccess: () => { toast.success("Paket dihapus"); qc.invalidateQueries({ queryKey: ["packages"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const w = can(me, "packages.write");
  return (
    <div>
      <PageHeader eyebrow="Operasional" title="Paket Internet" subtitle="Setiap paket dipetakan ke PPP Profile MikroTik untuk auto update profile saat ganti paket."
        actions={w && <Button size="sm" onClick={() => setForm({ editing: null })} data-testid="packages-add-button"><Plus className="h-4 w-4" />Tambah Paket</Button>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="packages-grid">
        {data.map((p, i) => (
          <div key={p.id} style={{ animationDelay: `${i * 40}ms` }} data-testid={`package-card-${p.mikrotik_profile || p.id}`}
            className="animate-rise group relative overflow-hidden rounded-xl border bg-card p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-sky-500/40">
            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-sky-500/10 blur-2xl" />
            <div className="flex items-start justify-between">
              <div>
                <div className="font-heading text-lg font-semibold">{p.name}</div>
                <div className="mt-0.5 font-mono text-xs text-sky-300">{p.mikrotik_profile || "— tanpa profile —"}</div>
              </div>
              <StatusBadge value={p.active ? "active" : "stopped"} label={p.active ? "Aktif" : "Nonaktif"} />
            </div>
            <div className="mt-4 font-heading text-3xl font-bold tracking-tight">{p.speed}</div>
            <div className="mt-1 font-mono text-lg font-bold text-emerald-400">{rupiah(p.price)}<span className="text-xs font-normal text-muted-foreground"> /bulan</span></div>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><ArrowDown className="h-3 w-3" />{p.download}</span>
              <span className="flex items-center gap-1"><ArrowUp className="h-3 w-3" />{p.upload}</span>
              <span>FUP: {p.fup}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-muted-foreground" data-testid={`package-subscribers-${p.id}`}>{p.subscribers} pelanggan</span>
              {w && <div className="flex gap-1">
                <Button size="icon-xs" variant="ghost" onClick={() => setForm({ editing: p })} data-testid={`package-edit-${p.id}`}><Pencil /></Button>
                <ConfirmButton label="" icon={<Trash2 className="h-3.5 w-3.5" />} variant="ghost" title="Hapus paket" message={`Hapus paket ${p.name}?`} onConfirm={() => del.mutate(p.id)} testid={`package-delete-${p.id}`} />
              </div>}
            </div>
          </div>
        ))}
      </div>
      {form && <PackageForm editing={form.editing} onClose={() => setForm(null)} />}
    </div>
  );
}
