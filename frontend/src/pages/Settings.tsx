import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Download, Pencil, Plus, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Field, NSelect, PageHeader, Panel, StatusBadge } from "@/components/common";
import { KV, Modal, Tbl } from "@/components/kit";
import { apiGet, apiPost, apiPut, errMsg } from "@/lib/api";
import { fmtDate, ROLE_LABEL } from "@/lib/format";
import type { AcsConfig, AcsConfigIn, AcsTestResult, BackupFile, Health, IsolationMethod, Role, Settings, User, UserIn, WaConfig, WaConfigIn, WaProvider, WaTestResult } from "@/lib/types";

const METHODS: [IsolationMethod, string][] = [["disable_secret", "Disable PPP Secret"], ["change_profile", "Change PPP Profile"], ["disconnect", "Disconnect Active Session"]];

function Toggle({ label, checked, onChange, testid, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; testid: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border bg-background/40 p-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} data-testid={testid} className="mt-0.5" />
      <span><span className="text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}

function SettingsForm() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/settings") });
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  const save = useMutation({
    mutationFn: (s: Settings) => apiPut<Settings>("/settings", s),
    onSuccess: (s) => { qc.setQueryData(["settings"], s); toast.success("Pengaturan disimpan"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!f) return <div className="text-sm text-muted-foreground">Memuat…</div>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  const toggleMethod = (m: IsolationMethod) => set("isolation_methods", f.isolation_methods.includes(m) ? f.isolation_methods.filter((x) => x !== m) : [...f.isolation_methods, m]);
  return (
    <div className="space-y-4">
      <Panel title="Network → MikroTik" testid="settings-mikrotik-panel">
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200">
          <ShieldAlert className="h-4 w-4 shrink-0" />Protokol: MikroTik API (8728). Default aman: Auto Isolation & Auto Activation OFF. Lakukan TEST CONNECTION di setiap router sebelum mengaktifkan otomasi.
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle label="Enable MikroTik Integration" checked={f.mikrotik_enabled} onChange={(v) => set("mikrotik_enabled", v)} testid="settings-mikrotik-enabled" hint="Jika OFF, billing tetap berjalan tanpa aksi ke router" />
          <Toggle label="Auto Sync" checked={f.auto_sync} onChange={(v) => set("auto_sync", v)} testid="settings-auto-sync" />
          <Toggle label="Auto Isolation" checked={f.auto_isolation} onChange={(v) => set("auto_isolation", v)} testid="settings-auto-isolation" hint="Isolir otomatis invoice overdue melewati grace period" />
          <Toggle label="Auto Activation" checked={f.auto_activation} onChange={(v) => set("auto_activation", v)} testid="settings-auto-activation" hint="Aktifkan kembali otomatis setelah pembayaran" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Default Protocol"><NSelect value={f.default_protocol} onChange={(v) => set("default_protocol", v as Settings["default_protocol"])} options={[{ value: "api", label: "API (8728)" }]} testid="settings-protocol-select" /></Field>
          <Field label="API Port"><Input type="number" value={f.api_port} onChange={(e) => set("api_port", Number(e.target.value))} data-testid="settings-api-port" /></Field>
          <Field label="Timeout (ms)"><Input type="number" value={f.timeout_ms} onChange={(e) => set("timeout_ms", Number(e.target.value))} data-testid="settings-timeout" /></Field>
          <Field label="Retry Count"><Input type="number" value={f.retry_count} onChange={(e) => set("retry_count", Number(e.target.value))} data-testid="settings-retry" /></Field>
          <Field label="Polling (detik)" hint="30–300"><Input type="number" value={f.polling_interval} onChange={(e) => set("polling_interval", Number(e.target.value))} data-testid="settings-polling" /></Field>
        </div>
      </Panel>
      <Panel title="Billing & Isolir" testid="settings-billing-panel">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Grace Period (hari)"><Input type="number" value={f.grace_days} onChange={(e) => set("grace_days", Number(e.target.value))} data-testid="settings-grace" /></Field>
          <Field label="Default jatuh tempo (tgl)"><Input type="number" value={f.due_day} onChange={(e) => set("due_day", Number(e.target.value))} data-testid="settings-due-day" /></Field>
          <Field label="Denda keterlambatan (Rp)"><Input type="number" value={f.late_fee} onChange={(e) => set("late_fee", Number(e.target.value))} data-testid="settings-late-fee" /></Field>
          <Field label="Profile isolir"><Input value={f.isolation_profile} onChange={(e) => set("isolation_profile", e.target.value)} className="font-mono" data-testid="settings-isolation-profile" /></Field>
        </div>
        <div className="mt-3 text-xs font-medium text-muted-foreground">Isolation Method</div>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {METHODS.map(([m, l]) => <Toggle key={m} label={l} checked={f.isolation_methods.includes(m)} onChange={() => toggleMethod(m)} testid={`settings-method-${m}`} />)}
        </div>
        <div className="mt-2 font-mono text-xs text-muted-foreground">Contoh: jatuh tempo tgl {f.due_day} + grace {f.grace_days} hari → isolir tgl {f.due_day + f.grace_days + 1}</div>
      </Panel>
      <Panel title="Perusahaan & WhatsApp" testid="settings-company-panel">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama perusahaan"><Input value={f.company_name} onChange={(e) => set("company_name", e.target.value)} data-testid="settings-company-name" /></Field>
          <Field label="Telepon"><Input value={f.company_phone} onChange={(e) => set("company_phone", e.target.value)} data-testid="settings-company-phone" /></Field>
          <Field label="Alamat"><Input value={f.company_address} onChange={(e) => set("company_address", e.target.value)} data-testid="settings-company-address" /></Field>
          <Field label="WhatsApp provider"><Input readOnly value={f.whatsapp_provider} data-testid="settings-wa-provider" /></Field>
        </div>
      </Panel>
      <Button onClick={() => save.mutate(f)} disabled={save.isPending} data-testid="settings-save-button"><Save className="h-4 w-4" />Simpan Pengaturan</Button>
    </div>
  );
}

function WhatsAppPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["wa-config"], queryFn: () => apiGet<WaConfig>("/whatsapp/config") });
  const [f, setF] = useState<WaConfigIn | null>(null);
  const [testTo, setTestTo] = useState("");
  const [test, setTest] = useState<WaTestResult | null>(null);
  useEffect(() => { if (data) setF({ provider: data.provider, token: "", country_code: data.country_code, device_label: data.device_label }); }, [data]);
  const save = useMutation({
    mutationFn: (b: WaConfigIn) => apiPut<WaConfig>("/whatsapp/config", { ...b, token: b.token || null }),
    onSuccess: (c) => { qc.setQueryData(["wa-config"], c); qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Konfigurasi WhatsApp disimpan"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const run = useMutation({
    mutationFn: () => apiPost<WaTestResult>("/whatsapp/test", { to: testTo }),
    onSuccess: (r) => { setTest(r); qc.invalidateQueries({ queryKey: ["wa-config"] }); r.success ? toast.success(r.message) : toast.error(r.message); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!f) return <div className="text-sm text-muted-foreground">Memuat…</div>;
  const set = <K extends keyof WaConfigIn>(k: K, v: WaConfigIn[K]) => setF({ ...f, [k]: v });
  return (
    <Panel title="WhatsApp Gateway" testid="settings-whatsapp-panel">
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 text-xs text-sky-200">
        <ShieldAlert className="h-4 w-4 shrink-0" />Mode <b>Simulator</b>: pesan hanya dicatat, tidak dikirim. Mode <b>Fonnte</b>: pesan dikirim dari nomor WhatsApp pribadi Anda yang dipasangkan (scan QR) di dashboard Fonnte. Token perangkat disimpan terenkripsi & tidak pernah dikembalikan ke browser.
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Provider"><NSelect value={f.provider} onChange={(v) => set("provider", v as WaProvider)} options={[{ value: "simulator", label: "Simulator (demo, tidak dikirim)" }, { value: "fonnte", label: "Fonnte (nomor pribadi via QR)" }]} testid="wa-provider-select" /></Field>
        <Field label="Label perangkat (opsional)" hint="Mis. 'WA Admin 0812…'"><Input value={f.device_label} onChange={(e) => set("device_label", e.target.value)} data-testid="wa-device-label-input" /></Field>
        {f.provider === "fonnte" && <>
          <Field label="Token perangkat Fonnte" hint={data?.has_token ? "Tersimpan terenkripsi · kosongkan jika tidak diubah" : "Ambil dari dashboard Fonnte → Device → Token"}><Input type="password" value={f.token ?? ""} onChange={(e) => set("token", e.target.value)} className="font-mono" placeholder="••••••••" data-testid="wa-token-input" /></Field>
          <Field label="Kode negara" hint="Default 62 (Indonesia)"><Input value={f.country_code} onChange={(e) => set("country_code", e.target.value)} className="font-mono" data-testid="wa-country-code-input" /></Field>
        </>}
      </div>
      {f.provider === "fonnte" && (
        <div className="mt-3 rounded-lg border bg-background/40 p-3 text-xs text-muted-foreground" data-testid="wa-pairing-steps">
          <b className="text-foreground">Cara memasangkan nomor pribadi:</b> 1) Daftar/masuk di fonnte.com. 2) Menu <b>Device</b> → Add Device → Connect, lalu scan QR dari WhatsApp (Perangkat Tertaut → Tautkan perangkat). 3) Klik <b>Token</b> pada device, salin ke kolom di atas. 4) Simpan, lalu kirim <b>Tes</b> ke nomor Anda sendiri.
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="w-full max-w-[220px]"><Field label="Nomor tujuan tes" hint="Format 628xxxxxxxxx"><Input value={testTo} onChange={(e) => setTestTo(e.target.value)} className="font-mono" placeholder="628123456789" data-testid="wa-test-to-input" /></Field></div>
        <Button onClick={() => save.mutate(f)} disabled={save.isPending} data-testid="wa-config-save-button"><Save className="h-4 w-4" />Simpan</Button>
        <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending || testTo.length < 8} data-testid="wa-config-test-button">{run.isPending ? "Mengirim…" : "Kirim Tes"}</Button>
      </div>
      {test && <div className={`mt-3 rounded-lg p-3 text-sm ${test.success ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`} data-testid="wa-test-result">{test.success ? "✓ " : "✕ "}{test.message} · via {test.provider} · {test.response_ms} ms</div>}
      {!test && data?.last_test && <div className="mt-3 text-xs text-muted-foreground">Tes terakhir: {fmtDate(data.last_test, true)} · {data.last_test_ok ? "berhasil" : "gagal"}</div>}
    </Panel>
  );
}

function GenieAcsPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["acs-config"], queryFn: () => apiGet<AcsConfig>("/genieacs/config") });
  const [f, setF] = useState<AcsConfigIn | null>(null);
  const [test, setTest] = useState<AcsTestResult | null>(null);
  useEffect(() => { if (data) setF({ enabled: data.enabled, mode: data.mode, url: data.url, username: data.username, password: "", online_minutes: data.online_minutes }); }, [data]);
  const save = useMutation({
    mutationFn: (b: AcsConfigIn) => apiPut<AcsConfig>("/genieacs/config", { ...b, password: b.password || null }),
    onSuccess: (c) => { qc.setQueryData(["acs-config"], c); qc.invalidateQueries({ queryKey: ["acs-devices"] }); toast.success("Konfigurasi GenieACS disimpan"); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const run = useMutation({
    mutationFn: () => apiPost<AcsTestResult>("/genieacs/test"),
    onSuccess: (r) => { setTest(r); qc.invalidateQueries({ queryKey: ["acs-config"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!f) return <div className="text-sm text-muted-foreground">Memuat…</div>;
  const set = <K extends keyof AcsConfigIn>(k: K, v: AcsConfigIn[K]) => setF({ ...f, [k]: v });
  return (
    <Panel title="GenieACS (TR-069) — NBI" testid="settings-genieacs-panel">
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle label="Enable GenieACS Integration" checked={f.enabled} onChange={(v) => set("enabled", v)} testid="acs-enabled-checkbox" hint="Manajemen ONT/modem pelanggan" />
        <Field label="Mode"><NSelect value={f.mode} onChange={(v) => set("mode", v as AcsConfigIn["mode"])} options={[{ value: "simulator", label: "Simulator (demo)" }, { value: "nbi", label: "GenieACS NBI (server asli)" }]} testid="acs-mode-select" /></Field>
        <Field label="URL NBI" hint="Contoh http://103.x.x.x:7557 — harus bisa diakses dari server aplikasi"><Input value={f.url} onChange={(e) => set("url", e.target.value)} className="font-mono" data-testid="acs-url-input" /></Field>
        <Field label="Batas online (menit sejak inform terakhir)"><Input type="number" value={f.online_minutes} onChange={(e) => set("online_minutes", Number(e.target.value))} data-testid="acs-online-minutes-input" /></Field>
        <Field label="Username NBI (opsional)"><Input value={f.username} onChange={(e) => set("username", e.target.value)} data-testid="acs-username-input" /></Field>
        <Field label="Password NBI" hint={data?.has_password ? "Tersimpan terenkripsi · kosongkan jika tidak diubah" : "Opsional"}><Input type="password" value={f.password ?? ""} onChange={(e) => set("password", e.target.value)} data-testid="acs-password-input" /></Field>
      </div>
      {test && <div className={`mt-3 rounded-lg p-3 text-sm ${test.success ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`} data-testid="acs-test-result">{test.success ? "✓ " : "✕ "}{test.message} · {test.response_ms} ms</div>}
      {!test && data?.last_test && <div className="mt-3 text-xs text-muted-foreground">Test terakhir: {fmtDate(data.last_test, true)} · {data.last_test_ok ? "berhasil" : "gagal"}</div>}
      <div className="mt-3 flex gap-2">
        <Button onClick={() => save.mutate(f)} disabled={save.isPending} data-testid="acs-save-button"><Save className="h-4 w-4" />Simpan</Button>
        <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending} data-testid="acs-test-button">{run.isPending ? "Menguji…" : "Test Koneksi GenieACS"}</Button>
      </div>
    </Panel>
  );
}

function Users() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["users"], queryFn: () => apiGet<User[]>("/users") });
  const [edit, setEdit] = useState<{ id: string | null; f: UserIn } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...edit!.f, password: edit!.f.password || null };
      return edit!.id ? apiPut<User>(`/users/${edit!.id}`, body) : apiPost<User>("/users", body);
    },
    onSuccess: () => { toast.success("User tersimpan"); qc.invalidateQueries({ queryKey: ["users"] }); setEdit(null); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const set = <K extends keyof UserIn>(k: K, v: UserIn[K]) => setEdit((e) => e && { ...e, f: { ...e.f, [k]: v } });
  return (
    <Panel title="User & Role (RBAC)" testid="settings-users-panel"
      actions={<Button size="xs" onClick={() => setEdit({ id: null, f: { email: "", name: "", role: "cs", phone: "", password: "", active: true } })} data-testid="users-add-button"><Plus className="h-3.5 w-3.5" />Tambah User</Button>}>
      <Tbl testid="users-table" head={["Nama", "Email", "Role", "Telepon", "Status", ""]}>
        {data.map((u) => (
          <tr key={u.id} data-testid={`user-row-${u.email}`}>
            <td className="font-medium">{u.name}</td><td className="font-mono text-xs">{u.email}</td>
            <td className="text-xs text-sky-300">{ROLE_LABEL[u.role]}</td><td className="font-mono text-xs">{u.phone}</td>
            <td><StatusBadge value={u.active ? "active" : "stopped"} label={u.active ? "Aktif" : "Nonaktif"} /></td>
            <td className="text-right"><Button size="icon-xs" variant="ghost" onClick={() => setEdit({ id: u.id, f: { email: u.email, name: u.name, role: u.role, phone: u.phone, password: "", active: u.active } })} data-testid={`user-edit-${u.email}`}><Pencil /></Button></td>
          </tr>
        ))}
      </Tbl>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Edit User" : "Tambah User"} testid="user-form-dialog"
          footer={<Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="user-form-submit">Simpan</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama"><Input value={edit.f.name} onChange={(e) => set("name", e.target.value)} data-testid="user-name-input" /></Field>
            <Field label="Email"><Input value={edit.f.email} onChange={(e) => set("email", e.target.value)} data-testid="user-email-input" /></Field>
            <Field label="Role"><NSelect value={edit.f.role} onChange={(v) => set("role", v as Role)} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} testid="user-role-select" /></Field>
            <Field label="Telepon / WA"><Input value={edit.f.phone} onChange={(e) => set("phone", e.target.value)} data-testid="user-phone-input" /></Field>
            <Field label="Password" hint={edit.id ? "Kosongkan jika tidak diubah" : "Min. 8 karakter"}><Input type="password" value={edit.f.password ?? ""} onChange={(e) => set("password", e.target.value)} data-testid="user-password-input" /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox checked={edit.f.active} onCheckedChange={(v) => set("active", !!v)} data-testid="user-active-checkbox" />Aktif</label>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function System() {
  const qc = useQueryClient();
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => apiGet<Health>("/health") });
  const { data: backups = [] } = useQuery({ queryKey: ["backups"], queryFn: () => apiGet<BackupFile[]>("/backups") });
  const backup = useMutation({
    mutationFn: () => apiPost<{ name: string }>("/backups"),
    onSuccess: (r) => { toast.success(`Backup dibuat: ${r.name}`); qc.invalidateQueries({ queryKey: ["backups"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Health Check (/api/health)" testid="settings-health-panel">
        {health && <>
          <KV k="Status" v={<StatusBadge value={health.status === "ok" ? "OK" : "FAILED"} label={health.status} testid="health-status" />} />
          {Object.entries(health.checks).map(([k, v]) => <KV key={k} k={k} v={typeof v === "object" ? JSON.stringify(v) : String(v)} mono />)}
          <KV k="Waktu" v={fmtDate(health.time, true)} />
        </>}
      </Panel>
      <Panel title="Backup (retensi 14 file, otomatis harian)" testid="settings-backup-panel"
        actions={<Button size="xs" onClick={() => backup.mutate()} disabled={backup.isPending} data-testid="backup-create-button"><Database className="h-3.5 w-3.5" />Backup Sekarang</Button>}>
        <div className="space-y-1.5">
          {backups.map((b) => (
            <div key={b.name} className="flex items-center justify-between rounded-lg border bg-background/40 px-3 py-1.5 text-xs" data-testid={`backup-row-${b.name}`}>
              <span className="font-mono">{b.name}</span>
              <span className="flex items-center gap-2 text-muted-foreground">{(b.size / 1024).toFixed(0)} KB
                <a href={`/api/backups/${b.name}`} data-testid={`backup-download-${b.name}`}><Button size="icon-xs" variant="ghost"><Download /></Button></a></span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader eyebrow="Pengaturan" title="Pengaturan" subtitle="Integrasi MikroTik, billing & isolir, user/role, health check dan backup." />
      <Tabs defaultValue="general">
        <TabsList data-testid="settings-tabs">
          <TabsTrigger value="general" data-testid="settings-tab-general">Network & Billing</TabsTrigger>
          <TabsTrigger value="genieacs" data-testid="settings-tab-genieacs">GenieACS</TabsTrigger>
          <TabsTrigger value="whatsapp" data-testid="settings-tab-whatsapp">WhatsApp</TabsTrigger>
          <TabsTrigger value="users" data-testid="settings-tab-users">User & Role</TabsTrigger>
          <TabsTrigger value="system" data-testid="settings-tab-system">Sistem & Backup</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-4"><SettingsForm /></TabsContent>
        <TabsContent value="genieacs" className="mt-4"><GenieAcsPanel /></TabsContent>
        <TabsContent value="whatsapp" className="mt-4"><WhatsAppPanel /></TabsContent>
        <TabsContent value="users" className="mt-4"><Users /></TabsContent>
        <TabsContent value="system" className="mt-4"><System /></TabsContent>
      </Tabs>
    </div>
  );
}
