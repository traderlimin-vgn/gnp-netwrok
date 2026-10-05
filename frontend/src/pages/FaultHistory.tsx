import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "@/lib/recharts";
import { Input } from "@/components/ui/input";
import { EmptyRow, NSelect, PageHeader, Pager, Panel, SearchInput, StatCard, StatusBadge } from "@/components/common";
import { FilterBar, Tbl } from "@/components/kit";
import { apiGet } from "@/lib/api";
import { exportCsv, fmtDate, mapsUrl } from "@/lib/format";
import type { FaultHistory as FH, FaultHotspot, FaultTrend, Paged } from "@/lib/types";

const LEVEL: Record<string, string> = { odc: "Feeder", odp: "Distribusi", drop: "Drop" };
const dur = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)}h ${Math.floor((m % 1440) / 60)}j` : m >= 60 ? `${Math.floor(m / 60)}j ${m % 60}m` : `${m}m`);
const tip = { contentStyle: { background: "#111827", border: "1px solid #1F2937", borderRadius: 10, fontSize: 12 }, labelStyle: { color: "#94A3B8" } };
const axis = { stroke: "#64748B", fontSize: 11, tickLine: false, axisLine: false };
const mmdd = (d: string) => d.slice(5);

export default function FaultHistory() {
  const [days, setDays] = useState(90);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(1);
  const { data: hot = [] } = useQuery({ queryKey: ["fault-hotspots", days], queryFn: () => apiGet<FaultHotspot[]>(`/network/fault-history/hotspots?days=${days}`) });
  const { data: trend } = useQuery({ queryKey: ["fault-trend", days], queryFn: () => apiGet<FaultTrend>(`/network/fault-history/trend?days=${days}`), refetchInterval: 60_000 });
  const params = new URLSearchParams({ q, status, level, page: String(page), limit: "30" });
  const { data, isLoading } = useQuery({ queryKey: ["fault-history", params.toString()], queryFn: () => apiGet<Paged<FH>>(`/network/fault-history?${params}`), refetchInterval: 60_000 });
  const rows = data?.items ?? [];
  const max = Math.max(1, ...hot.map((h) => h.count));
  return (
    <div>
      <PageHeader eyebrow="Lapangan" title="Riwayat Gangguan Kabel" subtitle="Dicatat otomatis tiap menit dari analisa GenieACS + topologi: kapan segmen putus, berapa lama, dan berapa pelanggan terdampak."
        actions={<Button2 onClick={() => exportCsv("riwayat-gangguan.csv", rows as unknown as Record<string, unknown>[], ["started_at", "resolved_at", "level", "segment", "title", "affected_max", "duration_min", "status"])} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="fault-trend-stats">
        <StatCard testid="fault-stat-total" label={`Gangguan ${days} hari`} value={trend?.summary.total ?? 0} tone="blue" />
        <StatCard testid="fault-stat-open" label="Masih Putus" value={trend?.summary.open ?? 0} tone="red" />
        <StatCard testid="fault-stat-mttr" label="Rata-rata Durasi (MTTR)" value={dur(trend?.summary.mttr_min ?? 0)} tone="amber" />
        <StatCard testid="fault-stat-affected" label="Total Terdampak" value={trend?.summary.affected_total ?? 0} tone="violet" />
      </div>
      <Panel title="Tren Gangguan Harian" className="mb-4" testid="fault-trend-panel"
        actions={trend ? <span className="text-xs text-muted-foreground" data-testid="fault-trend-breakdown">{trend.summary.resolved} pulih · {trend.summary.by_level.map((l) => `${LEVEL[l.level]} ${l.count}`).join(" · ")}</span> : undefined}>
        <div className="h-56" data-testid="fault-trend-chart">
          {trend && trend.summary.total === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="fault-trend-empty">Belum ada gangguan tercatat pada periode ini.</div>
          ) : (
            <ResponsiveContainer>
              <AreaChart data={trend?.points ?? []}>
                <defs><linearGradient id="flt" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F59E0B" stopOpacity={0.35} /><stop offset="100%" stopColor="#F59E0B" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#1F2937" vertical={false} />
                <XAxis dataKey="date" tickFormatter={mmdd} {...axis} /><YAxis allowDecimals={false} {...axis} width={28} />
                <Tooltip {...tip} labelFormatter={(d) => fmtDate(String(d))} />
                <Area type="monotone" dataKey="faults" name="Gangguan" stroke="#F59E0B" strokeWidth={2} fill="url(#flt)" />
                <Area type="monotone" dataKey="down" name="Putus total" stroke="#EF4444" strokeWidth={2} fillOpacity={0} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>
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
