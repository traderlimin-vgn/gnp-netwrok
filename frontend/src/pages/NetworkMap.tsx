import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";
import { PageHeader } from "@/components/common";
import { apiGet } from "@/lib/api";
import { mapsUrl } from "@/lib/format";
import type { MapPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

const LAYERS: { type: MapPoint["type"] | "cable"; label: string; color: string; radius: number }[] = [
  { type: "customer", label: "Rumah Pelanggan", color: "#10B981", radius: 5 },
  { type: "odp", label: "ODP", color: "#F59E0B", radius: 7 },
  { type: "odc", label: "ODC", color: "#A855F7", radius: 9 },
  { type: "router", label: "Router MikroTik", color: "#38BDF8", radius: 10 },
  { type: "technician", label: "Teknisi", color: "#F472B6", radius: 7 },
  { type: "psb", label: "PSB", color: "#60A5FA", radius: 7 },
  { type: "ticket", label: "Tiket", color: "#EF4444", radius: 8 },
  { type: "cable", label: "Kabel", color: "#64748B", radius: 0 },
];
const STATUS_FILL: Record<string, string> = { isolir: "#EF4444", suspend: "#F59E0B", stopped: "#64748B" };

export default function NetworkMap() {
  const { data = [] } = useQuery({ queryKey: ["map-points"], queryFn: () => apiGet<MapPoint[]>("/map/points") });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (t: string) => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const byId = useMemo(() => new Map(data.map((p) => [p.id, p])), [data]);
  const center: [number, number] = data.length ? [data.reduce((a, p) => a + p.latitude, 0) / data.length, data.reduce((a, p) => a + p.longitude, 0) / data.length] : [-7.41, 112.6];
  const cables = data.filter((p) => p.parent_id && byId.has(p.parent_id));
  return (
    <div>
      <PageHeader eyebrow="Lapangan" title="Peta Jaringan" subtitle="Leaflet + OpenStreetMap: pelanggan, ODP, ODC, router, teknisi, PSB, tiket dan jalur kabel." />
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
      </div>
      <div className="h-[calc(100vh-14rem)] min-h-[420px] overflow-hidden rounded-xl border" data-testid="network-map">
        {data.length > 0 && (
          <MapContainer center={center} zoom={13} className="h-full w-full" scrollWheelZoom>
            <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {!hidden.has("cable") && cables.map((p) => {
              const parent = byId.get(p.parent_id)!;
              return <Polyline key={`c-${p.id}`} positions={[[p.latitude, p.longitude], [parent.latitude, parent.longitude]]} pathOptions={{ color: "#64748B", weight: 2, dashArray: "4 4" }} />;
            })}
            {data.filter((p) => !hidden.has(p.type)).map((p) => {
              const l = LAYERS.find((x) => x.type === p.type)!;
              const fill = p.type === "customer" ? STATUS_FILL[p.status] ?? l.color : p.type === "router" && p.status === "offline" ? "#EF4444" : l.color;
              return (
                <CircleMarker key={`${p.type}-${p.id}`} center={[p.latitude, p.longitude]} radius={l.radius}
                  pathOptions={{ color: p.type === "router" || p.type === "odc" ? "#fff" : fill, weight: p.type === "router" || p.type === "odc" ? 2 : 1, fillColor: fill, fillOpacity: 0.85 }}>
                  <Popup>
                    <div className="text-xs">
                      <div className="font-semibold">{p.name}</div>
                      <div className="uppercase text-slate-500">{l.label}{p.status && ` · ${p.status}`}</div>
                      <div>{p.info}</div>
                      <a href={mapsUrl(p.latitude, p.longitude)} target="_blank" rel="noreferrer">Buka Google Maps</a>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
