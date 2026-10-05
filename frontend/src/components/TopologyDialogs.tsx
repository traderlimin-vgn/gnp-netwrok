import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NSelect } from "@/components/common";
import { ConfirmButton, Modal } from "@/components/kit";
import { apiDelete, apiPost, apiPut, errMsg } from "@/lib/api";
import type { AssetType, Cable, CableIn, CableKind, MapAsset, MapAssetIn } from "@/lib/types";

export const ASSET_LABEL: Record<AssetType, string> = { odc: "ODC", odp: "ODP", pole: "Tiang" };
export const CABLE_LABEL: Record<CableKind, string> = { feeder: "Feeder (POP → ODC)", distribution: "Distribusi (ODC → ODP)", drop: "Drop (ODP → rumah)" };
const DEFAULT_CAP: Record<AssetType, number> = { odc: 144, odp: 16, pole: 0 };

function useTopoInvalidate() {
  const qc = useQueryClient();
  return () => ["map-assets", "map-cables", "map-points", "network-faults"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function AssetDialog({ initial, editing, assets, onClose }: { initial: MapAssetIn; editing: MapAsset | null; assets: MapAsset[]; onClose: () => void }) {
  const inval = useTopoInvalidate();
  const [f, setF] = useState<MapAssetIn>(initial.capacity || editing ? initial : { ...initial, capacity: DEFAULT_CAP[initial.type] });
  const set = <K extends keyof MapAssetIn>(k: K, v: MapAssetIn[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => (editing ? apiPut<MapAsset>(`/map/assets/${editing.id}`, f) : apiPost<MapAsset>("/map/assets", f)),
    onSuccess: (a) => { toast.success(`${ASSET_LABEL[a.type]} ${a.name} tersimpan`); inval(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: () => apiDelete(`/map/assets/${editing!.id}`),
    onSuccess: () => { toast.success("Aset dihapus"); inval(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const parents = f.type === "odp" ? assets.filter((a) => a.type === "odc") : [];
  return (
    <Modal open onClose={onClose} title={`${editing ? "Edit" : "Tambah"} ${ASSET_LABEL[f.type]}`} testid="asset-dialog"
      footer={<>
        {editing && <ConfirmButton size="sm" variant="destructive" label="Hapus" icon={<Trash2 className="h-3.5 w-3.5" />} title="Hapus aset" message={`Hapus ${editing.name}? Jalur kabel yang terhubung ikut terhapus.`} onConfirm={() => del.mutate()} testid="asset-delete" />}
        <Button onClick={() => save.mutate()} disabled={save.isPending || f.name.length < 2} data-testid="asset-submit">Simpan</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis"><NSelect value={f.type} onChange={(v) => setF({ ...f, type: v as AssetType, parent_id: "" })} options={Object.entries(ASSET_LABEL).map(([value, label]) => ({ value, label }))} testid="asset-type-select" /></Field>
        <Field label="Nama"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={f.type === "pole" ? "TIANG-001" : `${ASSET_LABEL[f.type]}-GMP-09`} className="font-mono" data-testid="asset-name-input" /></Field>
        {f.type !== "pole" && <Field label="Kapasitas port" hint={editing ? `Terpakai ${editing.used} ${f.type === "odp" ? "pelanggan" : "ODP"}` : undefined}><Input type="number" value={f.capacity} onChange={(e) => set("capacity", Number(e.target.value))} data-testid="asset-capacity-input" /></Field>}
        {f.type === "odp" && <Field label="Induk ODC"><NSelect value={f.parent_id} onChange={(v) => set("parent_id", v)} options={parents.map((a) => ({ value: a.id, label: a.name }))} placeholder="— Pilih ODC —" testid="asset-parent-select" /></Field>}
        <Field label="Latitude"><Input type="number" step="any" value={f.latitude} onChange={(e) => set("latitude", Number(e.target.value))} data-testid="asset-lat-input" /></Field>
        <Field label="Longitude"><Input type="number" step="any" value={f.longitude} onChange={(e) => set("longitude", Number(e.target.value))} data-testid="asset-lng-input" /></Field>
        <Field label="Catatan" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} data-testid="asset-notes-input" /></Field>
      </div>
    </Modal>
  );
}

export function CableDialog({ initial, editing, assets, onClose }: { initial: CableIn; editing: Cable | null; assets: MapAsset[]; onClose: () => void }) {
  const inval = useTopoInvalidate();
  const [f, setF] = useState<CableIn>(initial);
  const set = <K extends keyof CableIn>(k: K, v: CableIn[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => (editing ? apiPut<Cable>(`/map/cables/${editing.id}`, f) : apiPost<Cable>("/map/cables", f)),
    onSuccess: (c) => { toast.success(`Jalur ${c.name} tersimpan · ${Math.round(c.length_m)} m`); inval(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: () => apiDelete(`/map/cables/${editing!.id}`),
    onSuccess: () => { toast.success("Jalur kabel dihapus"); inval(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const opts = assets.map((a) => ({ value: a.id, label: `${ASSET_LABEL[a.type]} · ${a.name}` }));
  return (
    <Modal open onClose={onClose} title={editing ? `Edit Jalur — ${editing.name}` : "Simpan Jalur Kabel"} description={`${f.path.length} titik${editing ? ` · ${Math.round(editing.length_m)} m` : ""}`} testid="cable-dialog"
      footer={<>
        {editing && <ConfirmButton size="sm" variant="destructive" label="Hapus" icon={<Trash2 className="h-3.5 w-3.5" />} title="Hapus jalur kabel" message={`Hapus jalur ${editing.name}?`} onConfirm={() => del.mutate()} testid="cable-delete" />}
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="cable-submit">Simpan</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis kabel"><NSelect value={f.kind} onChange={(v) => set("kind", v as CableKind)} options={Object.entries(CABLE_LABEL).map(([value, label]) => ({ value, label }))} testid="cable-kind-select" /></Field>
        <Field label="Jumlah core"><Input type="number" value={f.core_count} onChange={(e) => set("core_count", Number(e.target.value))} data-testid="cable-core-input" /></Field>
        <Field label="Dari"><NSelect value={f.from_id} onChange={(v) => set("from_id", v)} options={opts} placeholder="— POP / bebas —" testid="cable-from-select" /></Field>
        <Field label="Ke"><NSelect value={f.to_id} onChange={(v) => set("to_id", v)} options={opts} placeholder="— Pilih —" testid="cable-to-select" /></Field>
        <Field label="Nama (opsional)" className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Otomatis: JENIS DARI → KE" data-testid="cable-name-input" /></Field>
        <Field label="Catatan" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} data-testid="cable-notes-input" /></Field>
      </div>
    </Modal>
  );
}
