import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyRow, NSelect, PageHeader, Pager, Panel, SearchInput, StatusBadge } from "@/components/common";
import { FilterBar, Tbl } from "@/components/kit";
import { apiGet } from "@/lib/api";
import { exportCsv, fmtDate, mapsUrl } from "@/lib/format";
import type { FaultHistory as FH, FaultHotspot, Paged } from "@/lib/types";

const LEVEL: Record<string, string> = { odc: "Feeder", odp: "Distribusi", drop: "Drop" };
const dur = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)}h ${Math.floor((m % 1440) / 60)}j` : m >= 60 ? `${Math.floor(m / 60)}j ${m % 60}m` : `${m}m`);

export default function FaultHistory() {
  const [days, setDays] = useState(90);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(1);
  const { data: hot = [] } = useQuery({ queryKey: ["fault-hotspots", days], queryFn: () => apiGet<FaultHotspot[]>(`/network/fault-history/hotspots?days=${days}`) });
  const params = new URLSearchParams({ q, status, level, page: String(page), limit: "30" });
  const { data, isLoading } = useQuery({ queryKey: ["fault-history", params.toString()], queryFn: () => apiGet<Paged<FH>>(`/network/fault-history?${params}`), refetchInterval: 60_000 });
  const rows = data?.items ?? [];
  const max = Math.max(1, ...hot.map((h) => h.count));
  return (
    <div>
      <PageHeader eyebrow="Lapangan" title="Riwayat Gangguan Kabel" subtitle="Dicatat otomatis tiap menit dari analisa GenieACS + topologi: kapan segmen putus, berapa lama, dan berapa pelanggan terdampak."
        actions={<Button2 onClick={() => exportCsv("riwayat-gangguan.csv", rows as unknown as Record<string, unknown>[], ["started_at", "resolved_at", "level", "segment", "title", "affected_max", "duration_min", "status"])} />} />
      <Panel title="Titik Paling Sering Bermasalah" className="mb-4" testid="fault-hotspots-panel"
        actions={<div className="flex items-center gap-2 text-xs text-muted-foreground">Periode <Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value) || 90)} className="h-7 w-16" data-testid="hotspot-days-input" /> hari</div>}>
        {hot.length === 0 ? <div className="text-sm text-muted-foreground">Belum ada riwayat gangguan.</div> : (
          <div className="space-y-2">
            {hot.slice(0, 10).map((h, i) => (
              <div key={h.segment} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 text-sm" data-testid={`hotspot-row-${i}`}>
                <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sky-300">{h.segment}</span><StatusBadge value={h.level === "drop" ? "pending" : "offline"} label={LEVEL[h.level]} />
                    {h.open && <StatusBadge value="offline" label="Masih putus" />}
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-800"><div className="h-1.5 rounded-full bg-red-500/80 transition-[width] duration-500" style={{ width: `${(h.count / max) * 100}%` }} /></div>
                </div>
                <div className="text-right text-xs">
                  <div><b className="font-heading text-base">{h.count}×</b> · {dur(h.total_duration_min)}</div>
                  <div className="text-muted-foreground">maks {h.affected_max} plg · {fmtDate(h.last_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Segmen, mis. ODP-GMP-06…" testid="fault-history-search" />
          <NSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "open", label: "Masih putus" }, { value: "resolved", label: "Sudah pulih" }]} placeholder="Semua status" testid="fault-history-status" />
          <NSelect value={level} onChange={(v) => { setLevel(v); setPage(1); }} options={Object.entries(LEVEL).map(([value, label]) => ({ value, label }))} placeholder="Semua level" testid="fault-history-level" />
        </FilterBar>
        <Tbl testid="fault-history-table" head={["Mulai", "Pulih", "Level", "Segmen", "Keterangan", "Terdampak", "Durasi", "Status", ""]}>
          {isLoading && <EmptyRow cols={9} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={9} />}
          {rows.map((h) => (
            <tr key={h.id} data-testid={`fault-history-row-${h.id}`}>
              <td className="whitespace-nowrap font-mono text-xs">{fmtDate(h.started_at, true)}</td>
              <td className="whitespace-nowrap font-mono text-xs">{fmtDate(h.resolved_at, true)}</td>
              <td className="text-xs">{LEVEL[h.level]}</td>
              <td className="font-mono text-xs text-sky-300">{h.segment}</td>
              <td className="max-w-xs text-xs text-muted-foreground">{h.title}</td>
              <td className="font-mono text-xs">{h.affected_max}</td>
              <td className="font-mono text-xs">{h.status === "open" ? "berlangsung" : dur(h.duration_min)}</td>
              <td><StatusBadge value={h.status === "open" ? "offline" : "online"} label={h.status === "open" ? "Putus" : "Pulih"} /></td>
              <td><a href={mapsUrl(h.latitude, h.longitude)} target="_blank" rel="noreferrer" className="text-sky-400" data-testid={`fault-history-maps-${h.id}`}><MapPin className="h-4 w-4" /></a></td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={30} onPage={setPage} testid="fault-history-pager" />
      </Panel>
    </div>
  );
}

function Button2({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} data-testid="fault-history-export" className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-muted">Export CSV</button>;
}
