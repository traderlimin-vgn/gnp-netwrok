import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip as LTooltip, useMap, useMapEvents } from "react-leaflet";
import { AlertTriangle, Check, Crosshair, Magnet, Pencil, Plus, RefreshCw, Route, Scissors, Undo2, Wrench, X } from "lucide-react";
import { AssetDialog, CableDialog } from "@/components/TopologyDialogs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NSelect, PageHeader, StatusBadge } from "@/components/common";
import { apiGet, apiPost, errMsg } from "@/lib/api";
import { can, fmtDate, mapsUrl, useMe } from "@/lib/format";
import type { AcsConfig, AssetType, Cable, CableIn, Fault, FaultReport, MapAsset, MapAssetIn, MapPoint, Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";

const LAYERS: { type: MapPoint["type"] | "cable"; label: string; color: string; radius: number }[] = [
  { type: "customer", label: "Rumah Pelanggan", color: "#10B981", radius: 5 },
  { type: "odp", label: "ODP", color: "#F59E0B", radius: 7 },
  { type: "odc", label: "ODC", color: "#A855F7", radius: 9 },
  { type: "pole", label: "Tiang", color: "#94A3B8", radius: 4 },
  { type: "router", label: "Router MikroTik", color: "#38BDF8", radius: 10 },
  { type: "technician", label: "Teknisi", color: "#F472B6", radius: 7 },
  { type: "psb", label: "PSB", color: "#60A5FA", radius: 7 },
  { type: "ticket", label: "Tiket", color: "#EF4444", radius: 8 },
  { type: "cable", label: "Kabel", color: "#64748B", radius: 0 },
];
const ONT_COLOR: Record<string, string> = { online: "#10B981", weak: "#F59E0B", offline: "#EF4444" };
const SEV_COLOR: Record<string, string> = { ok: "#64748B", warning: "#F59E0B", down: "#EF4444" };

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, 16, { duration: 0.8 }); }, [map, target]);
  return null;
}

type EditMode = "view" | "edit" | `add-${AssetType}` | "draw";

function MapClicks({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))) });
  return null;
}

const nearestAsset = (assets: MapAsset[], pt: number[]) =>
  assets.reduce<MapAsset | null>((best, a) => (!best || (a.latitude - pt[0]) ** 2 + (a.longitude - pt[1]) ** 2 < (best.latitude - pt[0]) ** 2 + (best.longitude - pt[1]) ** 2 ? a : best), null);

const RAD = Math.PI / 180;
const SNAP_M = 35; // snap a drawn cable point to a pole within this radius (metres)
function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const la1 = aLat * RAD, la2 = bLat * RAD, dLa = (bLat - aLat) * RAD, dLo = (bLng - aLng) * RAD;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}

function FaultCard({ f, onFocus }: { f: Fault; onFocus: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const ticket = useMutation({
    mutationFn: () => apiPost<Ticket>("/tickets", {
      customer_id: f.affected[0].customer_id, priority: f.severity === "down" ? "critical" : "high", technician_id: "",
      complaint: `${f.title}. ${f.message}. Segmen: ${f.segment}. Pelanggan terdampak: ${f.affected.map((a) => a.customer_code).join(", ")}`,
      notes: `Lokasi: ${mapsUrl(f.latitude, f.longitude)}`,
    }),
    onSuccess: (t) => { toast.success(`${t.ticket_no} dibuat${t.technician_name ? ` · WA ke ${t.technician_name}` : ""}`); qc.invalidateQueries({ queryKey: ["tickets"] }); qc.invalidateQueries({ queryKey: ["map-points"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div data-testid={`fault-card-${f.id}`} className={cn("animate-rise rounded-lg border p-3 text-xs", f.severity === "down" ? "border-red-500/40 bg-red-500/[0.07]" : "border-amber-500/30 bg-amber-500/[0.05]")}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-foreground">{f.title}</div>
        <StatusBadge value={f.severity === "down" ? "offline" : "pending"} label={f.level.toUpperCase()} />
      </div>
      <div className="mt-1 font-mono text-sky-300">{f.segment}</div>
      <div className="mt-1 text-muted-foreground">{f.message}</div>
      <div className="mt-1 text-muted-foreground">Terdampak: {f.affected.slice(0, 4).map((a) => a.customer_name).join(", ")}{f.affected_count > 4 && ` +${f.affected_count - 4}`}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" onClick={onFocus} data-testid={`fault-focus-${f.id}`}><Crosshair className="h-3.5 w-3.5" />Lokasi</Button>
        <a href={mapsUrl(f.latitude, f.longitude)} target="_blank" rel="noreferrer"><Button size="xs" variant="outline">Google Maps</Button></a>
        {can(me, "tickets.write") && <Button size="xs" onClick={() => ticket.mutate()} disabled={ticket.isPending} data-testid={`fault-ticket-${f.id}`}><Wrench className="h-3.5 w-3.5" />Buat Tiket</Button>}
      </div>
    </div>
  );
}

export default function NetworkMap() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data = [] } = useQuery({ queryKey: ["map-points"], queryFn: () => apiGet<MapPoint[]>("/map/points") });
  const { data: report, error: faultErr, isFetching, refetch } = useQuery({ queryKey: ["network-faults"], queryFn: () => apiGet<FaultReport>("/network/faults"), refetchInterval: 60_000, retry: false });
  const { data: acsCfg } = useQuery({ queryKey: ["acs-config"], queryFn: () => apiGet<AcsConfig>("/genieacs/config"), enabled: can(me, "mikrotik.view") });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<[number, number] | null>(null);
  const [simOdp, setSimOdp] = useState("");
  const manage = can(me, "mikrotik.routers");
  const [mode, setMode] = useState<EditMode>("view");
  const [draft, setDraft] = useState<number[][]>([]);
  const [snap, setSnap] = useState(true);
  const [snapNames, setSnapNames] = useState<(string | null)[]>([]);
  const [assetDlg, setAssetDlg] = useState<{ initial: MapAssetIn; editing: MapAsset | null } | null>(null);
  const [cableDlg, setCableDlg] = useState<{ initial: CableIn; editing: Cable | null } | null>(null);
  const { data: assets = [] } = useQuery({ queryKey: ["map-assets"], queryFn: () => apiGet<MapAsset[]>("/map/assets") });
  const { data: routes = [] } = useQuery({ queryKey: ["map-cables"], queryFn: () => apiGet<Cable[]>("/map/cables") });
  const poles = useMemo(() => assets.filter((a) => a.type === "pole"), [assets]);
  const clearDraft = () => { setDraft([]); setSnapNames([]); };
  const snapTo = (lat: number, lng: number): { lat: number; lng: number; pole: string | null } => {
    if (!snap || !poles.length) return { lat, lng, pole: null };
    let best: MapAsset | null = null, bestD = Infinity;
    for (const p of poles) { const d = metersBetween(lat, lng, p.latitude, p.longitude); if (d < bestD) { bestD = d; best = p; } }
    return best && bestD <= SNAP_M ? { lat: best.latitude, lng: best.longitude, pole: best.name } : { lat, lng, pole: null };
  };
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const covered = useMemo(() => new Set(routes.flatMap((r) => [`${r.from_id}|${r.to_id}`, `${r.to_id}|${r.from_id}`])), [routes]);
  const editing = mode !== "view";
  const onMapClick = (lat: number, lng: number) => {
    if (mode === "draw") {
      const s = snapTo(lat, lng);
      setDraft((d) => [...d, [s.lat, s.lng]]);
      setSnapNames((n) => [...n, s.pole]);
      if (s.pole) toast.info(`Titik menempel ke ${s.pole}`);
    } else if (mode.startsWith("add-")) {
      const type = mode.slice(4) as AssetType;
      setAssetDlg({ initial: { type, name: "", latitude: lat, longitude: lng, capacity: 0, parent_id: type === "odp" ? nearestAsset(assets.filter((a) => a.type === "odc"), [lat, lng])?.id ?? "" : "", notes: "" }, editing: null });
      setMode("edit");
    }
  };
  const finishDraw = () => {
    const from = nearestAsset(assets, draft[0]);
    const to = nearestAsset(assets, draft[draft.length - 1]);
    const kind = to?.type === "odc" ? "feeder" : to?.type === "odp" ? "distribution" : "drop";
    setCableDlg({ initial: { name: "", kind, from_id: from?.id ?? "", to_id: to?.id ?? "", path: draft, core_count: kind === "feeder" ? 48 : kind === "distribution" ? 12 : 1, notes: "" }, editing: null });
    clearDraft();
    setMode("edit");
  };
  const editAsset = (id: string) => { const a = assetById.get(id); if (a) setAssetDlg({ initial: { type: a.type, name: a.name, latitude: a.latitude, longitude: a.longitude, capacity: a.capacity, parent_id: a.parent_id, notes: a.notes }, editing: a }); };
  const toggle = (t: string) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const byId = useMemo(() => new Map(data.map((p) => [p.id, p])), [data]);
  const ont = useMemo(() => new Map((report?.onts ?? []).map((o) => [o.customer_id, o])), [report]);
  const odpSev = useMemo(() => new Map((report?.odps ?? []).map((o) => [o.odp_id, o])), [report]);
  const odcSev = useMemo(() => new Map((report?.odcs ?? []).map((o) => [o.odc_id, o])), [report]);
  const center: [number, number] = data.length ? [data.reduce((a, p) => a + p.latitude, 0) / data.length, data.reduce((a, p) => a + p.longitude, 0) / data.length] : [-7.41, 112.6];
  const cables = data.filter((p) => p.parent_id && byId.has(p.parent_id) && !covered.has(`${p.id}|${p.parent_id}`));
  const faults = report?.faults ?? [];
  const down = faults.filter((f) => f.severity === "down");
  const sim = useMutation({
    mutationFn: (cut: boolean) => apiPost<{ odp_name: string; onts: number; cut: boolean }>("/network/faults/simulate", { odp_id: simOdp, cut }),
    onSuccess: (r) => { toast.success(`${r.cut ? "Simulasi putus kabel" : "Kabel dipulihkan"} di ${r.odp_name} (${r.onts} ONT)`); qc.invalidateQueries({ queryKey: ["network-faults"] }); qc.invalidateQueries({ queryKey: ["acs-devices"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  const cableStyle = (p: MapPoint) => {
    if (p.type === "customer") {
      const o = ont.get(p.id);
      const bad = o?.ont_status === "offline";
      return { color: bad ? "#EF4444" : "#475569", weight: bad ? 2 : 1, dashArray: "2 4", opacity: bad ? 0.9 : 0.5 };
    }
    const sev = p.type === "odp" ? odpSev.get(p.id)?.severity : undefined;
    const parentDown = odcSev.get(p.parent_id)?.severity === "down";
    const c = parentDown || sev === "down" ? "#EF4444" : sev === "warning" ? "#F59E0B" : "#64748B";
    return { color: c, weight: c === "#EF4444" ? 4 : 2, dashArray: c === "#EF4444" ? "8 6" : "4 4", className: c === "#EF4444" ? "gmp-cable-cut" : "" };
  };

  return (
    <div>
      <PageHeader eyebrow="Lapangan" title="Peta Jaringan" subtitle="Leaflet + OpenStreetMap terhubung GenieACS: status ONT tiap rumah, kesehatan ODP/ODC, dan lokasi dugaan putus kabel."
        actions={<Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="map-refresh-faults"><RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />Analisa Ulang</Button>} />
      <div className="mb-3 flex flex-wrap gap-2" data-testid="map-layer-toggles">
        {LAYERS.map((l) => {
          const count = l.type === "cable" ? cables.length : data.filter((p) => p.type === l.type).length;
          return (
            <button key={l.type} onClick={() => toggle(l.type)} data-testid={`map-toggle-${l.type}`}
              className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-[opacity,border-color] duration-150", hidden.has(l.type) ? "opacity-40" : "border-sky-500/30 bg-card")}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.label}<span className="font-mono text-muted-foreground">{count}</span>
            </button>
          );
        })}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          ONT: <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />online</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />redaman tinggi</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />LOS/offline</span>
        </span>
      </div>
      {manage && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2" data-testid="map-edit-toolbar">
          <Button size="sm" variant={editing ? "default" : "outline"} onClick={() => { setMode(editing ? "view" : "edit"); clearDraft(); }} data-testid="map-edit-toggle"><Pencil className="h-3.5 w-3.5" />{editing ? "Selesai Edit" : "Edit Topologi"}</Button>
          {editing && <>
            {(["odc", "odp", "pole"] as AssetType[]).map((t) => (
              <Button key={t} size="sm" variant={mode === `add-${t}` ? "secondary" : "outline"} onClick={() => setMode(`add-${t}`)} data-testid={`map-add-${t}`}><Plus className="h-3.5 w-3.5" />{t === "pole" ? "Tiang" : t.toUpperCase()}</Button>
            ))}
            <Button size="sm" variant={mode === "draw" ? "secondary" : "outline"} onClick={() => { setMode("draw"); clearDraft(); }} data-testid="map-draw-cable"><Route className="h-3.5 w-3.5" />Gambar Kabel</Button>
            {mode === "draw" && <>
              <Button size="sm" variant={snap ? "secondary" : "outline"} onClick={() => setSnap((s) => !s)} data-testid="map-draw-snap" title={`Tempelkan titik ke tiang terdekat (≤ ${SNAP_M} m)`}><Magnet className="h-3.5 w-3.5" />Snap Tiang: {snap ? "ON" : "OFF"}</Button>
              <Button size="sm" variant="ghost" disabled={!draft.length} onClick={() => { setDraft((d) => d.slice(0, -1)); setSnapNames((n) => n.slice(0, -1)); }} data-testid="map-draw-undo"><Undo2 className="h-3.5 w-3.5" />Undo</Button>
              <Button size="sm" disabled={draft.length < 2} onClick={finishDraw} data-testid="map-draw-finish"><Check className="h-3.5 w-3.5" />Selesai ({draft.length} titik)</Button>
              <Button size="sm" variant="ghost" onClick={() => { clearDraft(); setMode("edit"); }} data-testid="map-draw-cancel"><X className="h-3.5 w-3.5" />Batal</Button>
            </>}
            <span className="text-xs text-muted-foreground" data-testid="map-edit-hint">
              {mode === "draw" ? `Klik peta untuk menambah titik jalur. ${snap ? "Snap aktif: titik menempel otomatis ke tiang ≤ " + SNAP_M + " m." : "Snap mati: titik mengikuti klik persis."} Titik awal/akhir dicocokkan ke aset terdekat.` : mode.startsWith("add-") ? "Klik lokasi di peta untuk menempatkan aset." : "Klik marker → Edit, atau klik jalur kabel untuk mengubah/hapus."}
            </span>
          </>}
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        <div className="h-[calc(100vh-15rem)] min-h-[440px] overflow-hidden rounded-xl border" data-testid="network-map">
          {data.length > 0 && (
            <MapContainer center={center} zoom={13} className={cn("h-full w-full", (mode === "draw" || mode.startsWith("add-")) && "[&_.leaflet-container]:cursor-crosshair cursor-crosshair")} scrollWheelZoom>
              <FlyTo target={target} />
              <MapClicks onClick={onMapClick} />
              {!hidden.has("cable") && routes.map((r) => {
                const toPt = byId.get(r.to_id);
                const style = toPt ? cableStyle(toPt) : { color: "#64748B", weight: 2 };
                return (
                  <Polyline key={`r-${r.id}`} positions={r.path as [number, number][]} pathOptions={{ ...style, dashArray: style.color === "#EF4444" ? "8 6" : undefined, weight: (style.weight ?? 2) + 1 }}
                    eventHandlers={{ click: () => { if (editing && manage) setCableDlg({ initial: { name: r.name, kind: r.kind, from_id: r.from_id, to_id: r.to_id, path: r.path, core_count: r.core_count, notes: r.notes }, editing: r }); } }}>
                    <LTooltip sticky>{r.name} · {r.core_count} core · {Math.round(r.length_m)} m</LTooltip>
                  </Polyline>
                );
              })}
              {draft.length > 0 && <Polyline positions={draft as [number, number][]} pathOptions={{ color: "#38BDF8", weight: 3, dashArray: "6 4" }} />}
              {draft.map((d, i) => <CircleMarker key={`d-${i}`} center={d as [number, number]} radius={snapNames[i] ? 5 : 4} pathOptions={{ color: snapNames[i] ? "#F59E0B" : "#38BDF8", fillColor: "#0B0F17", fillOpacity: 1, weight: 2 }}>{snapNames[i] && <LTooltip direction="top" className="!text-[10px]">{snapNames[i]}</LTooltip>}</CircleMarker>)}
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {!hidden.has("cable") && cables.map((p) => {
                const parent = byId.get(p.parent_id)!;
                return <Polyline key={`c-${p.id}`} positions={[[p.latitude, p.longitude], [parent.latitude, parent.longitude]]} pathOptions={cableStyle(p)} />;
              })}
              {faults.filter((f) => f.severity === "down").map((f) => (
                <CircleMarker key={`f-${f.id}`} center={[f.latitude, f.longitude]} radius={22} pathOptions={{ color: "#EF4444", weight: 2, fillColor: "#EF4444", fillOpacity: 0.15, className: "gmp-fault-pulse" }}>
                  <LTooltip direction="top" permanent className="!text-[10px] !font-semibold">⚠ {f.segment}</LTooltip>
                </CircleMarker>
              ))}
              {data.filter((p) => !hidden.has(p.type)).map((p) => {
                const l = LAYERS.find((x) => x.type === p.type)!;
                const o = p.type === "customer" ? ont.get(p.id) : undefined;
                const sev = p.type === "odp" ? odpSev.get(p.id) : p.type === "odc" ? odcSev.get(p.id) : undefined;
                const fill = o ? ONT_COLOR[o.ont_status] : sev && sev.severity !== "ok" ? SEV_COLOR[sev.severity] : p.type === "router" && p.status === "offline" ? "#EF4444" : l.color;
                const ring = p.type === "router" || p.type === "odc" || p.type === "odp";
                return (
                  <CircleMarker key={`${p.type}-${p.id}`} center={[p.latitude, p.longitude]} radius={l.radius}
                    pathOptions={{ color: ring ? (sev && sev.severity !== "ok" ? SEV_COLOR[sev.severity] : "#fff") : fill, weight: ring ? 2 : 1, fillColor: p.type === "odp" || p.type === "odc" ? l.color : fill, fillOpacity: 0.9 }}>
                    <Popup>
                      <div className="text-xs">
                        <div className="font-semibold">{p.name}</div>
                        <div className="uppercase text-slate-500">{l.label}{p.status && ` · ${p.status}`}</div>
                        <div>{p.info}</div>
                        {o && <div>ONT {o.serial}: <b style={{ color: ONT_COLOR[o.ont_status] }}>{o.ont_status === "offline" ? "LOS / offline" : o.ont_status}</b> · RX {o.rx_power ?? "-"} dBm</div>}
                        {sev && "total" in sev && <div>ONT: {sev.online} online · {sev.weak} redaman · <b>{sev.offline} offline</b> / {sev.total}</div>}
                        {sev && "odps_total" in sev && <div>ODP down: {sev.odps_down}/{sev.odps_total}</div>}
                        <a href={mapsUrl(p.latitude, p.longitude)} target="_blank" rel="noreferrer">Buka Google Maps</a>
                        {editing && manage && assetById.has(p.id) && <button className="ml-2 font-semibold text-sky-600 underline" onClick={() => editAsset(p.id)} data-testid={`map-edit-asset-${p.id}`}>Edit {p.name}</button>}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          )}
        </div>
        <aside className="flex max-h-[calc(100vh-15rem)] min-h-[440px] flex-col rounded-xl border bg-card" data-testid="fault-panel">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-red-400" />Dugaan Gangguan Kabel</div>
            <div className="mt-1 text-[11px] text-muted-foreground" data-testid="fault-summary">
              {report ? <>{down.length} putus · {faults.length - down.length} peringatan · analisa {fmtDate(report.generated_at, true)}</> : "Menganalisa data GenieACS…"}
            </div>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {faultErr && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300" data-testid="fault-error">{errMsg(faultErr)}</div>}
            {report && faults.length === 0 && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-300" data-testid="fault-none">Semua jalur kabel normal — tidak ada ONT LOS massal.</div>}
            {faults.map((f) => <FaultCard key={f.id} f={f} onFocus={() => setTarget([f.latitude, f.longitude])} />)}
          </div>
          {assetDlg && <AssetDialog initial={assetDlg.initial} editing={assetDlg.editing} assets={assets} onClose={() => setAssetDlg(null)} />}
          {cableDlg && <CableDialog initial={cableDlg.initial} editing={cableDlg.editing} assets={assets} onClose={() => setCableDlg(null)} />}
          {acsCfg?.mode === "simulator" && can(me, "mikrotik.control") && (
            <div className="border-t p-3" data-testid="fault-simulator">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Demo: simulasi putus kabel</div>
              <div className="flex gap-1.5">
                <NSelect value={simOdp} onChange={setSimOdp} options={(report?.odps ?? []).filter((o) => o.total).map((o) => ({ value: o.odp_id, label: `${o.odp_name} (${o.total} ONT)` }))} placeholder="Pilih ODP" testid="fault-sim-odp-select" className="min-w-0 flex-1" />
                <Button size="sm" variant="destructive" disabled={!simOdp || sim.isPending} onClick={() => sim.mutate(true)} data-testid="fault-sim-cut"><Scissors className="h-3.5 w-3.5" />Putus</Button>
                <Button size="sm" variant="outline" disabled={!simOdp || sim.isPending} onClick={() => sim.mutate(false)} data-testid="fault-sim-restore">Pulih</Button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
