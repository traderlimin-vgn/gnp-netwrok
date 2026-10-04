import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dot, EmptyRow, NSelect, PageHeader, Panel, SearchInput } from "@/components/common";
import { ConfirmButton, FilterBar, Tbl } from "@/components/kit";
import { apiGet, apiPost, errMsg } from "@/lib/api";
import { can, exportCsv, fmtBps, useMe } from "@/lib/format";
import type { ActionResult, PppSession, Router, Settings } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = { online: "🟢 Online", offline: "🔴 Offline", connecting: "🟡 Connecting", unknown: "⚫ Unknown" };

export default function Pppoe() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [routerId, setRouterId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<{ t: string; rx: number; tx: number }[]>([]);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/settings") });
  const { data: routers = [] } = useQuery({ queryKey: ["routers"], queryFn: () => apiGet<Router[]>("/mikrotik/routers") });
  const interval = Math.min(Math.max(settings?.polling_interval ?? 30, 30), 300) * 1000;
  const params = new URLSearchParams({ router_id: routerId, status, q });
  const { data = [], isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["pppoe", params.toString()], queryFn: () => apiGet<PppSession[]>(`/mikrotik/pppoe?${params}`), refetchInterval: interval,
  });
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const rx = data.reduce((a, s) => a + (s.rx_bps || 0), 0);
    const tx = data.reduce((a, s) => a + (s.tx_bps || 0), 0);
    const t = new Date(dataUpdatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setHistory((h) => [...h.slice(-29), { t, rx: rx / 1e6, tx: tx / 1e6 }]);
  }, [dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const disc = useMutation({
    mutationFn: (customerId: string) => apiPost<ActionResult>(`/mikrotik/customers/${customerId}/disconnect`),
    onSuccess: (r) => { (r.result === "SUCCESS" ? toast.success : toast.warning)(`${r.result}: ${r.message}`); qc.invalidateQueries({ queryKey: ["pppoe"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const counts = { online: 0, offline: 0, connecting: 0, unknown: 0 } as Record<string, number>;
  data.forEach((s) => { counts[s.status] = (counts[s.status] ?? 0) + 1; });
  return (
    <div>
      <PageHeader eyebrow="Network" title="Monitoring PPPoE" subtitle={`PPP Secret & PPP Active dari semua router. Polling setiap ${interval / 1000} detik (dapat diatur di Pengaturan) agar tidak membebani MikroTik.`}
        actions={<Button size="sm" variant="outline" onClick={() => exportCsv("pppoe.csv", data as unknown as Record<string, unknown>[], ["router_name", "username", "customer_name", "address", "caller_id", "uptime", "service", "profile", "interface", "status"])} data-testid="pppoe-export-button"><Download className="h-4 w-4" />Export</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3" data-testid={`pppoe-count-${k}`}><Dot status={k} /><span className="font-heading text-xl font-bold">{v}</span><span className="text-xs capitalize text-muted-foreground">{k}</span></div>
        ))}
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground" data-testid="pppoe-count-total"><span className="font-heading text-xl font-bold text-foreground">{data.length}</span> PPP Secret</div>
      </div>
      <Panel title="Traffic Agregat (RX / TX Mbps)" className="mb-4" testid="pppoe-traffic-chart">
        <div className="h-48">
          <ResponsiveContainer>
            <AreaChart data={history}>
              <CartesianGrid stroke="#1F2937" vertical={false} />
              <XAxis dataKey="t" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} width={36} />
              <Tooltip<number, string> contentStyle={{ background: "#111827", border: "1px solid #1F2937", fontSize: 12 }} formatter={(v) => `${v.toFixed(2)} Mbps`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area dataKey="rx" name="RX / Download" stroke="#38BDF8" fill="#38BDF833" isAnimationActive={false} />
              <Area dataKey="tx" name="TX / Upload" stroke="#10B981" fill="#10B98133" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={setQ} placeholder="Username, pelanggan, IP, MAC…" testid="pppoe-search-input" />
          <NSelect value={routerId} onChange={setRouterId} options={routers.map((r) => ({ value: r.id, label: r.name }))} placeholder="Semua router" testid="pppoe-router-filter" />
          <NSelect value={status} onChange={setStatus} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} placeholder="Semua status" testid="pppoe-status-filter" />
        </FilterBar>
        <Tbl testid="pppoe-table" head={["Status", "Username", "Pelanggan", "Router", "IP Address", "MAC Address", "Uptime", "Profile / Service", "Interface", "RX / TX", ""]}>
          {isLoading && <EmptyRow cols={11} text="Mengambil data dari MikroTik…" />}
          {!isLoading && data.length === 0 && <EmptyRow cols={11} />}
          {data.map((s) => (
            <tr key={`${s.router_id}-${s.username}`} data-testid={`pppoe-row-${s.username}`}>
              <td className="whitespace-nowrap text-xs"><span className="inline-flex items-center gap-2"><Dot status={s.status} />{s.status}{s.disabled && <span className="text-red-400">· disabled</span>}</span></td>
              <td className="font-mono text-xs text-sky-300">{s.username}</td>
              <td className="text-sm">{s.customer_name || "-"}</td>
              <td className="font-mono text-xs">{s.router_name}</td>
              <td className="font-mono text-xs">{s.address || "-"}</td>
              <td className="font-mono text-xs">{s.caller_id || "-"}</td>
              <td className="font-mono text-xs">{s.uptime || "-"}</td>
              <td className="font-mono text-xs">{s.profile} <span className="text-muted-foreground">/ {s.service}</span></td>
              <td className="font-mono text-xs">{s.interface || "-"}</td>
              <td className="whitespace-nowrap font-mono text-xs">{fmtBps(s.rx_bps)} / {fmtBps(s.tx_bps)}</td>
              <td className="text-right">
                {can(me, "mikrotik.control") && s.status === "online" && s.customer_id && (
                  <ConfirmButton label="DISCONNECT" icon={<Unplug className="h-3.5 w-3.5" />} variant="destructive" title="Disconnect PPPoE"
                    message={`Putus session aktif ${s.username} di ${s.router_name}? Pelanggan akan reconnect otomatis.`} onConfirm={() => disc.mutate(s.customer_id)} testid={`pppoe-disconnect-${s.username}`} />
                )}
              </td>
            </tr>
          ))}
        </Tbl>
      </Panel>
    </div>
  );
}
