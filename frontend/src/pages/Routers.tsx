import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, KeyRound, MemoryStick, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Zap, CheckCircle2, XCircle, Server } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dot, Field, NSelect, PageHeader, Panel, StatusBadge } from "@/components/common";
import { ConfirmButton, KV, Modal } from "@/components/kit";
import { apiDelete, apiGet, apiPost, apiPut, errMsg } from "@/lib/api";
import { can, fmtDate, useMe } from "@/lib/format";
import type { Router, RouterIn, SyncResult, TestResult } from "@/lib/types";

const EMPTY: RouterIn = {
  name: "", location: "", host: "", api_port: 8728, username: "gmp-api", password: "", routeros_version: "",
  mode: "api", latitude: null, longitude: null,
};

function RouterForm({ editing, onClose }: { editing: Router | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<RouterIn>(editing ? {
    name: editing.name, location: editing.location, host: editing.host, api_port: editing.api_port,
    username: editing.username, password: "", routeros_version: editing.routeros_version,
    mode: editing.mode as RouterIn["mode"], latitude: editing.latitude, longitude: editing.longitude,
  } : EMPTY);
  const set = <K extends keyof RouterIn>(k: K, v: RouterIn[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, password: f.password ? f.password : null };
      return editing ? apiPut<Router>(`/mikrotik/routers/${editing.id}`, body) : apiPost<Router>("/mikrotik/routers", body);
    },
    onSuccess: () => { toast.success("Router tersimpan. Jalankan TEST CONNECTION sebelum mengaktifkan otomasi."); qc.invalidateQueries({ queryKey: ["routers"] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const nn = (v: string) => (v === "" ? null : Number(v));
  return (
    <Modal open onClose={onClose} wide title={editing ? `Edit ${editing.name}` : "Tambah MikroTik Router"} testid="router-form-dialog"
      description="Credential dienkripsi di server (AES) dan tidak pernah dikirim kembali ke browser. Gunakan user khusus berizin minimum (gmp-api)."
      footer={<><Button variant="outline" onClick={onClose} data-testid="router-form-cancel">Batal</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !f.name || !f.host || !f.username || (!editing && !f.password)} data-testid="router-form-submit">Simpan</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Nama Router"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="GMP-KRIAN-01" className="font-mono" data-testid="router-name-input" /></Field>
        <Field label="Nama lokasi"><Input value={f.location} onChange={(e) => set("location", e.target.value)} data-testid="router-location-input" /></Field>
        <Field label="IP Address / Host"><Input value={f.host} onChange={(e) => set("host", e.target.value)} placeholder="IP publik / domain, mis. 103.x.x.x" className="font-mono" data-testid="router-host-input" /></Field>
        <Field label="Port API"><Input type="number" value={f.api_port} onChange={(e) => set("api_port", Number(e.target.value))} data-testid="router-api-port-input" /></Field>
        <Field label="RouterOS Version"><Input value={f.routeros_version} onChange={(e) => set("routeros_version", e.target.value)} placeholder="auto-detect" data-testid="router-version-input" /></Field>
        <Field label="Username MikroTik (RouterOS)" hint="User di /system user RouterOS, group ber-policy 'api' + read/write"><Input value={f.username} onChange={(e) => set("username", e.target.value)} placeholder="mis. gmp-api" className="font-mono" data-testid="router-username-input" /></Field>
        <Field label="Password MikroTik (RouterOS)" hint={editing?.has_password ? "Tersimpan terenkripsi · kosongkan jika tidak diubah" : "Password user RouterOS tsb · disimpan terenkripsi"}><Input type="password" value={f.password ?? ""} onChange={(e) => set("password", e.target.value)} placeholder="********" data-testid="router-password-input" /></Field>
        <Field label="Mode Koneksi" hint="Simulator untuk demo tanpa router fisik"><NSelect value={f.mode} onChange={(v) => set("mode", v as RouterIn["mode"])} options={[{ value: "api", label: "MikroTik API (RouterOS)" }, { value: "simulator", label: "Simulator" }]} testid="router-mode-select" /></Field>
        <Field label="Latitude"><Input type="number" step="any" value={f.latitude ?? ""} onChange={(e) => set("latitude", nn(e.target.value))} data-testid="router-lat-input" /></Field>
        <Field label="Longitude"><Input type="number" step="any" value={f.longitude ?? ""} onChange={(e) => set("longitude", nn(e.target.value))} data-testid="router-lng-input" /></Field>
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2 text-xs text-sky-200 sm:col-span-3" data-testid="router-protocol-note">Koneksi langsung: isi IP publik / domain + Port API (default 8728, bisa port forward lain). Di router: /ip service set api disabled=no port=8728 address=IP-server-GMP.</div>
      </div>
    </Modal>
  );
}

function TestDialog({ r, result, pending, onClose }: { r: Router; result: TestResult | null; pending: boolean; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Test Connection — ${r.name}`} description={`${r.connection_type} ${r.host}:${r.api_port}`} testid="router-test-dialog">
      {pending && <div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />Menghubungi router (dengan retry & backoff)…</div>}
      {result && (
        <div className="space-y-2" data-testid="router-test-result">
          {result.steps.map((s) => (
            <div key={s.key} className="flex items-start gap-2 text-sm" data-testid={`router-test-step-${s.key}`}>
              {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-400" />}
              <div><div className={s.ok ? "text-emerald-300" : "text-red-300"}>{s.label}</div>{s.detail && <div className="font-mono text-xs text-muted-foreground">{s.detail}</div>}</div>
            </div>
          ))}
          <div className={`mt-3 rounded-lg p-3 text-sm ${result.success ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`} data-testid="router-test-message">
            {result.success ? `✓ Connected · ${result.identity} · RouterOS ${result.version} · ${result.response_ms} ms` : `${result.error_code}: ${result.message}`}
          </div>
        </div>
      )}
    </Modal>
  );
}

function SystemDialog({ r, onClose }: { r: Router; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["router-system", r.id], queryFn: () => apiGet<{ router: Router; interfaces: Record<string, unknown>[] }>(`/mikrotik/routers/${r.id}/system`) });
  return (
    <Modal open onClose={onClose} wide title={`Health — ${r.name}`} testid="router-system-dialog">
      {isLoading && <div className="text-sm text-muted-foreground">Memuat…</div>}
      {error && <div className="text-sm text-red-400">{errMsg(error)}</div>}
      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <KV k="Status" v={<StatusBadge value={data.router.status} />} /><KV k="Identity" v={data.router.identity} mono />
            <KV k="RouterOS" v={data.router.routeros_version} mono /><KV k="CPU" v={`${data.router.cpu}%`} /><KV k="RAM" v={`${data.router.memory_used_pct}%`} />
            <KV k="Uptime" v={data.router.uptime} mono /><KV k="API response" v={`${data.router.response_ms} ms`} /><KV k="Last error" v={data.router.last_error} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Interfaces</div>
            <div className="max-h-72 space-y-1 overflow-y-auto" data-testid="router-interfaces">
              {data.interfaces.length === 0 && <div className="text-xs text-muted-foreground">Tidak tersedia</div>}
              {data.interfaces.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between rounded border border-border/60 px-2 py-1 font-mono text-xs">
                  <span>{String(i.name ?? "")}</span><span className="text-muted-foreground">{String(i.type ?? "")}</span>
                  <Dot status={i.running === true || i.running === "true" ? "online" : "offline"} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Routers() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data = [], isLoading } = useQuery({ queryKey: ["routers"], queryFn: () => apiGet<Router[]>("/mikrotik/routers"), refetchInterval: 60_000 });
  const [form, setForm] = useState<{ editing: Router | null } | null>(null);
  const [testing, setTesting] = useState<Router | null>(null);
  const [sys, setSys] = useState<Router | null>(null);
  const [syncRes, setSyncRes] = useState<{ r: Router; res: SyncResult } | null>(null);
  const test = useMutation({
    mutationFn: (r: Router) => apiPost<TestResult>(`/mikrotik/routers/${r.id}/test`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["routers"] }),
    onError: (e) => { toast.error(errMsg(e)); setTesting(null); },
  });
  const sync = useMutation({
    mutationFn: (r: Router) => apiPost<SyncResult>(`/mikrotik/routers/${r.id}/sync`).then((res) => ({ r, res })),
    onSuccess: (x) => { setSyncRes(x); ["routers", "customers", "pppoe"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/mikrotik/routers/${id}`),
    onSuccess: () => { toast.success("Router dihapus"); qc.invalidateQueries({ queryKey: ["routers"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const online = data.filter((r) => r.status === "online").length;
  const manage = can(me, "mikrotik.routers");
  return (
    <div>
      <PageHeader eyebrow="Network" title="MikroTik Routers" subtitle="NETWORK GMP → Backend → MikroTik API (8728) → Router. Tidak ada koneksi langsung dari browser ke MikroTik."
        actions={manage && <Button size="sm" onClick={() => setForm({ editing: null })} data-testid="routers-add-button"><Plus className="h-4 w-4" />Tambah Router</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm" data-testid="routers-online-count"><Dot status="online" /><b>{online}</b> Online</div>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm" data-testid="routers-offline-count"><Dot status="offline" /><b>{data.length - online}</b> Offline</div>
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-200"><ShieldCheck className="h-4 w-4" />Batasi API hanya dari IP server/VPN via firewall MikroTik</div>
      </div>
      {isLoading && <div className="text-sm text-muted-foreground">Memuat…</div>}
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3" data-testid="routers-grid">
        {data.map((r) => (
          <div key={r.id} className="animate-rise rounded-xl border bg-card p-4 transition-[border-color] duration-200 hover:border-sky-500/30" data-testid={`router-card-${r.name}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-800/80"><Server className="h-5 w-5 text-sky-300" /></div>
                <div>
                  <div className="font-mono text-sm font-bold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.router_code} · {r.location}</div>
                </div>
              </div>
              <span className="flex items-center gap-2"><Dot status={r.status} /><StatusBadge value={r.status} testid={`router-status-${r.name}`} /></span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 text-xs">
              <KV k="Host" v={r.host} mono /><KV k="Protokol" v={r.connection_type} mono />
              <KV k="Port API" v={String(r.api_port)} mono /><KV k="User" v={<span className="inline-flex items-center gap-1"><KeyRound className="h-3 w-3" />{r.username}</span>} mono />
              <KV k="RouterOS" v={r.routeros_version} mono /><KV k="Koneksi" v="Langsung" />
              <KV k="Mode" v={r.mode} /><KV k="Pelanggan" v={String(r.customers)} />
              <KV k="Last connected" v={fmtDate(r.last_connected, true)} /><KV k="Last sync" v={fmtDate(r.last_sync, true)} />
            </div>
            <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Cpu className="h-3.5 w-3.5" />CPU {r.cpu}%</span>
              <span className="flex items-center gap-1"><MemoryStick className="h-3.5 w-3.5" />RAM {r.memory_used_pct}%</span>
              <span className="flex items-center gap-1"><Zap className="h-3.5 w-3.5" />{r.response_ms} ms</span>
              <span className="truncate">{r.uptime}</span>
            </div>
            {r.last_error && <div className="mt-2 truncate rounded bg-red-500/10 px-2 py-1 font-mono text-[11px] text-red-300" title={r.last_error}>{r.last_error}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {manage && <Button size="xs" onClick={() => { setTesting(r); test.reset(); test.mutate(r); }} data-testid={`router-test-${r.name}`}><Zap className="h-3.5 w-3.5" />TEST CONNECTION</Button>}
              {can(me, "mikrotik.control") && <Button size="xs" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate(r)} data-testid={`router-sync-${r.name}`}><RefreshCw className={`h-3.5 w-3.5 ${sync.isPending && sync.variables?.id === r.id ? "animate-spin" : ""}`} />SYNC MIKROTIK</Button>}
              <Button size="xs" variant="outline" onClick={() => setSys(r)} data-testid={`router-health-${r.name}`}>Health</Button>
              {manage && <Button size="icon-xs" variant="ghost" onClick={() => setForm({ editing: r })} data-testid={`router-edit-${r.name}`}><Pencil /></Button>}
              {manage && <ConfirmButton label="" icon={<Trash2 className="h-3.5 w-3.5" />} variant="ghost" title="Hapus router" message={`Hapus ${r.name}? Pelanggan terkait akan terlepas dari router.`} onConfirm={() => del.mutate(r.id)} testid={`router-delete-${r.name}`} />}
            </div>
          </div>
        ))}
      </div>
      {form && <RouterForm editing={form.editing} onClose={() => setForm(null)} />}
      {testing && <TestDialog r={testing} result={test.data ?? null} pending={test.isPending} onClose={() => setTesting(null)} />}
      {sys && <SystemDialog r={sys} onClose={() => setSys(null)} />}
      {syncRes && (
        <Modal open onClose={() => setSyncRes(null)} title={`Hasil Sync — ${syncRes.r.name}`} testid="router-sync-dialog">
          <div className="grid grid-cols-5 gap-2 text-center" data-testid="router-sync-result">
            {(["synced", "created", "updated", "skipped", "failed"] as const).map((k) => (
              <div key={k} className="rounded-lg border bg-background/50 p-2"><div className="font-heading text-2xl font-bold">{syncRes.res[k]}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div></div>
            ))}
          </div>
          {syncRes.res.errors.length > 0 && <div className="mt-2 space-y-1">{syncRes.res.errors.map((e, i) => <div key={i} className="font-mono text-xs text-red-300">{e}</div>)}</div>}
        </Modal>
      )}
      <Panel title="Topologi koneksi langsung" className="mt-4">
        <div className="font-mono text-xs leading-6 text-muted-foreground">
          NETWORK GMP SERVER → Internet (IP publik / port forward) → MikroTik API :8728 (/ip service set api address=IP-server) → PPPoE / Hotspot → Pelanggan
        </div>
      </Panel>
    </div>
  );
}
