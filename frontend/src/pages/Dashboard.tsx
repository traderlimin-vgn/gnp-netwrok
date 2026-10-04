import { useQuery } from "@tanstack/react-query";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Activity, AlertTriangle, Ban, HardHat, Router as RouterIcon, TrendingUp, UserMinus, UserPlus, Users, Wallet, Wifi, WifiOff, Lock, ReceiptText, Coins } from "lucide-react";
import { PageHeader, Panel, StatCard, StatusBadge } from "@/components/common";
import { apiGet } from "@/lib/api";
import { CUSTOMER_STATUS, fmtDate, num, rupiah } from "@/lib/format";
import type { Dashboard as DashboardData } from "@/lib/types";

const PIE_COLORS: Record<string, string> = { active: "#10B981", suspend: "#F59E0B", isolir: "#EF4444", stopped: "#64748B", pending: "#38BDF8" };
const tip = { contentStyle: { background: "#111827", border: "1px solid #1F2937", borderRadius: 10, fontSize: 12 }, labelStyle: { color: "#94A3B8" } };
const axis = { stroke: "#64748B", fontSize: 11, tickLine: false, axisLine: false };
const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}jt` : n >= 1000 ? `${Math.round(n / 1000)}rb` : String(n));

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<DashboardData>("/dashboard"), refetchInterval: 60_000 });
  if (isLoading || !data) return <div className="text-sm text-muted-foreground" data-testid="dashboard-loading">Memuat dashboard…</div>;
  const s = data.stats;
  return (
    <div>
      <PageHeader eyebrow="Network Operations Center" title="Dashboard" subtitle="Ringkasan pelanggan, billing, dan kesehatan jaringan MikroTik bulan berjalan." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard testid="stat-total-customers" label="Total Pelanggan" value={num(s.total_customers)} icon={<Users className="h-4 w-4" />} className="col-span-2 md:col-span-1" />
        <StatCard testid="stat-active" label="Aktif" value={num(s.active)} tone="green" icon={<Activity className="h-4 w-4" />} />
        <StatCard testid="stat-suspend" label="Suspend" value={num(s.suspend)} tone="amber" icon={<Ban className="h-4 w-4" />} />
        <StatCard testid="stat-isolir" label="Isolir" value={num(s.isolir)} tone="red" icon={<Lock className="h-4 w-4" />} />
        <StatCard testid="stat-arrears" label="Menunggak" value={num(s.arrears)} tone="red" icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard testid="stat-technicians" label="Teknisi" value={num(s.technicians)} tone="violet" icon={<HardHat className="h-4 w-4" />} />
        <StatCard testid="stat-billed-month" label="Tagihan Bulan Ini" value={<span className="font-mono text-xl">{rupiah(s.billed_month)}</span>} icon={<ReceiptText className="h-4 w-4" />} className="col-span-2" />
        <StatCard testid="stat-paid-month" label="Pembayaran Bulan Ini" value={<span className="font-mono text-xl text-emerald-400">{rupiah(s.paid_month)}</span>} tone="green" icon={<Wallet className="h-4 w-4" />} className="col-span-2" />
        <StatCard testid="stat-revenue-today" label="Pendapatan Hari Ini" value={<span className="font-mono text-xl text-emerald-400">{rupiah(s.revenue_today)}</span>} tone="green" icon={<Coins className="h-4 w-4" />} />
        <StatCard testid="stat-revenue-month" label="Pendapatan Bulan Ini" value={<span className="font-mono text-xl text-emerald-400">{rupiah(s.revenue_month)}</span>} tone="green" icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard testid="stat-new-customers" label="Pelanggan Baru" value={num(s.new_customers)} tone="blue" icon={<UserPlus className="h-4 w-4" />} />
        <StatCard testid="stat-stopped" label="Berhenti" value={num(s.stopped_customers)} tone="slate" icon={<UserMinus className="h-4 w-4" />} />
        <StatCard testid="stat-routers" label="MikroTik Router" value={<span><span className="text-emerald-400">{s.routers_online}</span> <span className="text-sm text-muted-foreground">/</span> <span className="text-red-400">{s.routers_offline}</span></span>} hint="Online / Offline" icon={<RouterIcon className="h-4 w-4" />} />
        <StatCard testid="stat-pppoe" label="PPPoE" value={<span><span className="text-emerald-400">{s.pppoe_online}</span> <span className="text-sm text-muted-foreground">/</span> <span className="text-red-400">{s.pppoe_offline}</span></span>} hint="Online / Offline" tone="green" icon={s.pppoe_online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />} />
        <StatCard testid="stat-open-tickets" label="Tiket Terbuka" value={num(s.open_tickets)} tone="amber" icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard testid="stat-pending-mikrotik" label="Antrian MikroTik" value={num(s.pending_mikrotik)} tone="amber" hint="Aksi pending retry" icon={<RouterIcon className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Pendapatan Bulanan" className="xl:col-span-2" testid="chart-revenue">
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={data.monthly}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#1F2937" vertical={false} />
                <XAxis dataKey="period" {...axis} /><YAxis tickFormatter={short} {...axis} width={44} />
                <Tooltip<number, string> {...tip} formatter={(v) => rupiah(v)} />
                <Area type="monotone" dataKey="revenue" name="Pendapatan" stroke="#10B981" strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Status Pelanggan" testid="chart-status">
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.status_distribution.map((d) => ({ ...d, label: CUSTOMER_STATUS[d.status] ?? d.status }))} dataKey="count" nameKey="label" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {data.status_distribution.map((d) => <Cell key={d.status} fill={PIE_COLORS[d.status] ?? "#64748B"} stroke="none" />)}
                </Pie>
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Tagihan vs Pembayaran" testid="chart-billing">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={data.monthly}>
                <CartesianGrid stroke="#1F2937" vertical={false} />
                <XAxis dataKey="period" {...axis} /><YAxis tickFormatter={short} {...axis} width={44} />
                <Tooltip<number, string> {...tip} formatter={(v) => rupiah(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="billed" name="Tagihan" fill="#0284C7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="payments" name="Pembayaran" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Pertumbuhan Pelanggan" testid="chart-growth">
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={data.monthly}>
                <CartesianGrid stroke="#1F2937" vertical={false} />
                <XAxis dataKey="period" {...axis} /><YAxis {...axis} width={32} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="customers" name="Total" stroke="#38BDF8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="new_customers" name="Baru" stroke="#F59E0B" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Statistik Koneksi MikroTik" testid="chart-mikrotik">
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={data.routers} layout="vertical">
                <CartesianGrid stroke="#1F2937" horizontal={false} />
                <XAxis type="number" {...axis} /><YAxis type="category" dataKey="router" {...axis} width={110} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="online" name="Online" stackId="a" fill="#10B981" />
                <Bar dataKey="offline" name="Offline" stackId="a" fill="#EF4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Aktivitas MikroTik Terbaru" className="mt-4" testid="recent-actions">
        <div className="space-y-1.5">
          {data.recent_actions.length === 0 && <div className="text-sm text-muted-foreground">Belum ada aktivitas</div>}
          {data.recent_actions.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
              <span className="font-mono text-muted-foreground">{fmtDate(a.created_at, true)}</span>
              <span className="font-semibold">{a.action}</span>
              <span className="font-mono text-sky-300">{a.username || "-"}</span>
              <span className="text-muted-foreground">{a.router_name}</span>
              <span className="text-muted-foreground">{a.reason}</span>
              <span className="ml-auto"><StatusBadge value={a.result} /></span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
