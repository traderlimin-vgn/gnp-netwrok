import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Panel, StatCard } from "@/components/common";
import { Tbl } from "@/components/kit";
import { apiGet } from "@/lib/api";
import { num, PAY_METHOD, rupiah } from "@/lib/format";
import type { ReportData } from "@/lib/types";

const EXPORTS: [string, string][] = [["customers", "Pelanggan"], ["invoices", "Tagihan"], ["payments", "Pembayaran"], ["tickets", "Tiket"], ["psb", "PSB"], ["mikrotik_actions", "MikroTik Log"]];

export default function Reports() {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { data, isLoading } = useQuery({ queryKey: ["reports", period], queryFn: () => apiGet<ReportData>(`/reports?period=${period}`) });
  return (
    <div>
      <PageHeader eyebrow="Laporan & Audit" title="Laporan" subtitle="Keuangan, pelanggan, MikroTik dan kinerja teknisi per periode. Export CSV / Excel, atau cetak sebagai PDF."
        actions={<>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40" data-testid="reports-period-input" />
          <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="reports-print-button"><Printer className="h-4 w-4" />Cetak / PDF</Button>
        </>} />
      {isLoading || !data ? <div className="text-sm text-muted-foreground">Memuat laporan…</div> : (
        <div className="space-y-4">
          <Panel title="Laporan Keuangan" testid="report-finance">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard testid="report-revenue" label="Pendapatan" value={<span className="font-mono text-lg text-emerald-400">{rupiah(data.finance.revenue)}</span>} tone="green" hint={`${data.finance.payments_count} pembayaran`} />
              <StatCard testid="report-billed" label="Tagihan" value={<span className="font-mono text-lg">{rupiah(data.finance.billed)}</span>} />
              <StatCard testid="report-receivable" label="Piutang" value={<span className="font-mono text-lg text-amber-300">{rupiah(data.finance.receivable)}</span>} tone="amber" hint={`Overdue ${rupiah(data.finance.overdue)}`} />
              <StatCard testid="report-penalty" label="Denda / Diskon" value={<span className="font-mono text-lg">{rupiah(data.finance.penalty)}</span>} tone="red" hint={`Diskon ${rupiah(data.finance.discount)}`} />
            </div>
            <div className="mt-4 h-48">
              <ResponsiveContainer>
                <BarChart data={data.finance.by_method.map((m) => ({ ...m, label: PAY_METHOD[m.method] ?? m.method }))}>
                  <CartesianGrid stroke="#1F2937" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => `${Math.round(v / 1000)}rb`} />
                  <Tooltip<number, string> contentStyle={{ background: "#111827", border: "1px solid #1F2937", fontSize: 12 }} formatter={(v) => rupiah(v)} />
                  <Bar dataKey="total" name="Total" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Laporan Pelanggan" testid="report-customers">
              <div className="grid grid-cols-2 gap-3">
                <StatCard testid="report-cust-active" label="Aktif" value={num(data.customers.active)} tone="green" />
                <StatCard testid="report-cust-isolir" label="Isolir" value={num(data.customers.isolir)} tone="red" />
                <StatCard testid="report-cust-stopped" label="Berhenti" value={num(data.customers.stopped)} tone="slate" />
                <StatCard testid="report-cust-new" label="Baru" value={num(data.customers.new)} tone="blue" />
              </div>
            </Panel>
            <Panel title="Laporan MikroTik" testid="report-mikrotik">
              <div className="grid grid-cols-3 gap-3">
                <StatCard testid="report-mt-routers" label="Router" value={`${data.mikrotik.routers_online}/${data.mikrotik.routers}`} hint="online/total" />
                <StatCard testid="report-mt-online" label="PPPoE Active" value={num(data.mikrotik.pppoe_online)} tone="green" />
                <StatCard testid="report-mt-offline" label="PPPoE Offline" value={num(data.mikrotik.pppoe_offline)} tone="red" />
                <StatCard testid="report-mt-errors" label="API Error" value={num(data.mikrotik.api_errors)} tone="amber" />
                <StatCard testid="report-mt-syncs" label="Sync Log" value={num(data.mikrotik.syncs)} />
              </div>
            </Panel>
          </div>
          <Panel title="Laporan Teknisi" testid="report-technicians">
            <Tbl testid="report-technicians-table" head={["Teknisi", "Tiket selesai", "Tiket pending", "PSB selesai", "PSB pending"]}>
              {data.technicians.map((t) => (
                <tr key={t.name}><td className="font-medium">{t.name}</td><td className="font-mono">{t.tickets_done}</td><td className="font-mono text-amber-300">{t.tickets_pending}</td><td className="font-mono">{t.psb_done}</td><td className="font-mono text-amber-300">{t.psb_pending}</td></tr>
              ))}
            </Tbl>
          </Panel>
          <Panel title="Export Data" testid="report-exports">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {EXPORTS.map(([kind, label]) => (
                <div key={kind} className="flex items-center justify-between rounded-lg border bg-background/40 px-3 py-2">
                  <span className="text-sm">{label}</span>
                  <div className="flex gap-1">
                    <a href={`/api/reports/export?kind=${kind}&format=csv`} data-testid={`export-${kind}-csv`}><Button size="xs" variant="outline"><FileText className="h-3.5 w-3.5" />CSV</Button></a>
                    <a href={`/api/reports/export?kind=${kind}&format=xlsx`} data-testid={`export-${kind}-xlsx`}><Button size="xs" variant="outline"><FileSpreadsheet className="h-3.5 w-3.5" />Excel</Button></a>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
