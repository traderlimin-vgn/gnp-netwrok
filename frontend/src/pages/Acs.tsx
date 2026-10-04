import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Power, RefreshCw, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dot, EmptyRow, Field, NSelect, PageHeader, Panel, SearchInput, StatusBadge } from "@/components/common";
import { ConfirmButton, FilterBar, Modal, Tbl } from "@/components/kit";
import { apiGet, apiPost, apiPut, errMsg } from "@/lib/api";
import { can, exportCsv, fmtDate, useMe } from "@/lib/format";
import type { AcsActionResult, AcsConfig, AcsDevice, AcsWifiIn, Customer, Paged } from "@/lib/types";
import { cn } from "@/lib/utils";

export function rxTone(v: number | null) {
  if (v == null) return "text-muted-foreground";
  return v >= -25 ? "text-emerald-400" : v >= -27 ? "text-amber-300" : "text-red-400";
}
export const fmtUptime = (s: number) => (s ? `${Math.floor(s / 86400)}h ${Math.floor((s % 86400) / 3600)}j ${Math.floor((s % 3600) / 60)}m` : "-");
const enc = encodeURIComponent;

export function useAcsAction(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: "wifi" | "reboot" | "refresh"; body?: AcsWifiIn }) => apiPost<AcsActionResult>(`/genieacs/devices/${enc(id)}/${action}`, body),
    onSuccess: (r) => { (r.result === "DONE" ? toast.success : toast.warning)(`${r.result}: ${r.message}`); qc.invalidateQueries({ queryKey: ["acs-devices"] }); onDone?.(); },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function WifiDialog({ d, onClose }: { d: AcsDevice; onClose: () => void }) {
  const [f, setF] = useState<AcsWifiIn>({ ssid: d.ssid, password: "" });
  const act = useAcsAction(onClose);
  return (
    <Modal open onClose={onClose} title="Ganti SSID & Password WiFi" description={`${d.model} · ${d.serial} · ${d.customer_name || "belum terhubung"}`} testid="acs-wifi-dialog"
      footer={<Button onClick={() => act.mutate({ id: d.id, action: "wifi", body: f })} disabled={act.isPending || !f.ssid || f.password.length < 8} data-testid="acs-wifi-submit">Kirim ke ONT</Button>}>
      <div className="grid gap-3">
        <Field label="SSID (maks 32 karakter)"><Input value={f.ssid} maxLength={32} onChange={(e) => setF({ ...f, ssid: e.target.value })} data-testid="acs-wifi-ssid-input" /></Field>
        <Field label="Password WiFi (8–63 karakter)"><Input type="password" value={f.password} maxLength={63} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="acs-wifi-password-input" /></Field>
        <p className="text-xs text-muted-foreground">Dikirim via TR-069 setParameterValues. Perangkat pelanggan akan terputus sebentar dari WiFi.</p>
      </div>
    </Modal>
  );
}

function LinkDialog({ d, onClose }: { d: AcsDevice; onClose: () => void }) {
  const qc = useQueryClient();
  const [cq, setCq] = useState(d.pppoe_username);
  const [cid, setCid] = useState(d.customer_id);
  const { data } = useQuery({ queryKey: ["customers", "acs-pick", cq], queryFn: () => apiGet<Paged<Customer>>(`/customers?q=${enc(cq)}&limit=20`) });
  const save = useMutation({
    mutationFn: (customer_id: string) => apiPut(`/genieacs/devices/${enc(d.id)}/link`, { customer_id }),
    onSuccess: () => { toast.success("Relasi perangkat ↔ pelanggan disimpan"); qc.invalidateQueries({ queryKey: ["acs-devices"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Modal open onClose={onClose} title="Hubungkan ONT ke Pelanggan" description={`${d.serial} · PPPoE ${d.pppoe_username || "-"}`} testid="acs-link-dialog"
      footer={<>
        {d.link_type === "manual" && <Button variant="outline" onClick={() => save.mutate("")} data-testid="acs-unlink-button">Lepas relasi manual</Button>}
        <Button onClick={() => save.mutate(cid)} disabled={!cid || save.isPending} data-testid="acs-link-submit">Simpan</Button>
      </>}>
      <div className="grid gap-3">
        <Field label="Cari pelanggan"><Input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Nama / ID / PPPoE" data-testid="acs-link-search" /></Field>
        <Field label="Pelanggan"><NSelect value={cid} onChange={setCid} options={(data?.items ?? []).map((c) => ({ value: c.id, label: `${c.customer_code} · ${c.name} · ${c.pppoe_username}` }))} placeholder="— Pilih —" testid="acs-link-customer-select" /></Field>
        <p className="text-xs text-muted-foreground">Tanpa relasi manual, perangkat otomatis dicocokkan lewat PPPoE username.</p>
      </div>
    </Modal>
  );
}

export default function Acs() {
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [signal, setSignal] = useState("");
  const [wifi, setWifi] = useState<AcsDevice | null>(null);
  const [link, setLink] = useState<AcsDevice | null>(null);
  const { data: cfg } = useQuery({ queryKey: ["acs-config"], queryFn: () => apiGet<AcsConfig>("/genieacs/config") });
  const params = new URLSearchParams({ q, status });
  const { data = [], isLoading, error } = useQuery({ queryKey: ["acs-devices", params.toString()], queryFn: () => apiGet<AcsDevice[]>(`/genieacs/devices?${params}`), refetchInterval: 60_000 });
  const act = useAcsAction();
  const rows = data.filter((d) => !signal || (signal === "bad" ? (d.rx_power ?? 0) < -27 : signal === "warn" ? (d.rx_power ?? 0) < -25 && (d.rx_power ?? 0) >= -27 : (d.rx_power ?? -99) >= -25));
  const ctl = can(me, "mikrotik.control");
  const online = data.filter((d) => d.status === "online").length;
  const bad = data.filter((d) => d.rx_power != null && d.rx_power < -27).length;
  return (
    <div>
      <PageHeader eyebrow="Network" title="GenieACS / ONT" subtitle="Manajemen ONT/modem pelanggan via TR-069 (GenieACS NBI): status, redaman RX, WiFi, reboot dan relasi ke pelanggan."
        actions={<>
          {cfg && <StatusBadge value={cfg.mode === "simulator" ? "pending" : "active"} label={cfg.mode === "simulator" ? "Mode Simulator" : `NBI ${cfg.url}`} testid="acs-mode-badge" />}
          <Button size="sm" variant="outline" onClick={() => exportCsv("ont.csv", rows as unknown as Record<string, unknown>[], ["serial", "manufacturer", "model", "pppoe_username", "customer_code", "customer_name", "status", "rx_power", "tx_power", "ip", "ssid", "last_inform"])} data-testid="acs-export-button">Export</Button>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border bg-card px-4 py-3" data-testid="acs-count-total"><div className="font-heading text-2xl font-bold">{data.length}</div><div className="text-xs text-muted-foreground">Total ONT</div></div>
        <div className="rounded-xl border bg-card px-4 py-3" data-testid="acs-count-online"><div className="flex items-center gap-2 font-heading text-2xl font-bold"><Dot status="online" />{online}</div><div className="text-xs text-muted-foreground">Online</div></div>
        <div className="rounded-xl border bg-card px-4 py-3" data-testid="acs-count-offline"><div className="flex items-center gap-2 font-heading text-2xl font-bold"><Dot status="offline" />{data.length - online}</div><div className="text-xs text-muted-foreground">Offline / Unknown</div></div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3" data-testid="acs-count-bad-signal"><div className="font-heading text-2xl font-bold text-red-400">{bad}</div><div className="text-xs text-muted-foreground">Redaman buruk (&lt; -27 dBm)</div></div>
      </div>
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={setQ} placeholder="Serial, model, PPPoE, pelanggan, IP, SSID…" testid="acs-search-input" />
          <NSelect value={status} onChange={setStatus} options={[{ value: "online", label: "Online" }, { value: "offline", label: "Offline" }, { value: "unknown", label: "Unknown" }]} placeholder="Semua status" testid="acs-status-filter" />
          <NSelect value={signal} onChange={setSignal} options={[{ value: "good", label: "RX bagus (≥ -25)" }, { value: "warn", label: "RX waspada (-25..-27)" }, { value: "bad", label: "RX buruk (< -27)" }]} placeholder="Semua redaman" testid="acs-signal-filter" />
        </FilterBar>
        {error && <div className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300" data-testid="acs-error">{errMsg(error)}</div>}
        <Tbl testid="acs-table" head={["Status", "Perangkat", "Pelanggan", "PPPoE / IP", "RX / TX (dBm)", "Suhu", "WiFi", "Uptime", "Last Inform", ""]}>
          {isLoading && <EmptyRow cols={10} text="Mengambil data dari GenieACS…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={10} />}
          {rows.map((d) => (
            <tr key={d.id} data-testid={`acs-row-${d.serial}`}>
              <td className="whitespace-nowrap text-xs"><span className="inline-flex items-center gap-2"><Dot status={d.status} />{d.status}</span></td>
              <td><div className="font-mono text-xs text-sky-300">{d.serial}</div><div className="text-xs text-muted-foreground">{d.manufacturer} {d.model} · {d.software}</div></td>
              <td>{d.customer_name ? <><div className="text-sm">{d.customer_name}</div><div className="text-xs text-muted-foreground">{d.customer_code} · {d.link_type === "manual" ? "manual" : "auto PPPoE"}</div></> : <span className="text-xs text-amber-300">Belum terhubung</span>}</td>
              <td><div className="font-mono text-xs">{d.pppoe_username || "-"}</div><div className="font-mono text-xs text-muted-foreground">{d.ip || "-"}</div></td>
              <td className="whitespace-nowrap font-mono text-xs"><span className={cn("font-bold", rxTone(d.rx_power))} data-testid={`acs-rx-${d.serial}`}>{d.rx_power ?? "-"}</span> / {d.tx_power ?? "-"}</td>
              <td className="font-mono text-xs">{d.temperature != null ? `${d.temperature}°C` : "-"}</td>
              <td><div className="font-mono text-xs">{d.ssid || "-"}</div><div className="text-xs text-muted-foreground">{d.wifi_clients} klien</div></td>
              <td className="whitespace-nowrap font-mono text-xs">{fmtUptime(d.uptime)}</td>
              <td className="whitespace-nowrap text-xs">{fmtDate(d.last_inform, true)}</td>
              <td className="whitespace-nowrap text-right">
                {ctl && <>
                  <Button size="icon-xs" variant="ghost" title="Ganti WiFi" onClick={() => setWifi(d)} data-testid={`acs-wifi-${d.serial}`}><Wifi /></Button>
                  <Button size="icon-xs" variant="ghost" title="Refresh parameter" disabled={act.isPending} onClick={() => act.mutate({ id: d.id, action: "refresh" })} data-testid={`acs-refresh-${d.serial}`}><RefreshCw /></Button>
                  <Button size="icon-xs" variant="ghost" title="Hubungkan ke pelanggan" onClick={() => setLink(d)} data-testid={`acs-link-${d.serial}`}><Link2 /></Button>
                  <ConfirmButton label="" icon={<Power className="h-3.5 w-3.5" />} variant="ghost" title="Reboot ONT" message={`Reboot ${d.model} ${d.serial}${d.customer_name ? ` milik ${d.customer_name}` : ""}? Internet pelanggan akan putus 1–2 menit.`}
                    onConfirm={() => act.mutate({ id: d.id, action: "reboot" })} testid={`acs-reboot-${d.serial}`} />
                </>}
              </td>
            </tr>
          ))}
        </Tbl>
      </Panel>
      {wifi && <WifiDialog d={wifi} onClose={() => setWifi(null)} />}
      {link && <LinkDialog d={link} onClose={() => setLink(null)} />}
    </div>
  );
}
