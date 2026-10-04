import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyRow, NSelect, PageHeader, Pager, Panel, SearchInput, StatusBadge } from "@/components/common";
import { FilterBar, Tbl } from "@/components/kit";
import { apiGet, apiPost, errMsg } from "@/lib/api";
import { can, fmtDate, useMe } from "@/lib/format";
import type { MikrotikAction, Paged, PendingAction } from "@/lib/types";

const ACTIONS = ["CREATE_USER", "UPDATE_USER", "DELETE_USER", "ENABLE_USER", "DISABLE_USER", "DISCONNECT_USER", "SYNC", "TEST_CONNECTION", "UPDATE_PROFILE"];

export default function ActionLog() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q, action, result, page: String(page), limit: "30" });
  const { data, isLoading } = useQuery({ queryKey: ["mt-actions", params.toString()], queryFn: () => apiGet<Paged<MikrotikAction>>(`/mikrotik/actions?${params}`) });
  const { data: pending = [] } = useQuery({ queryKey: ["mt-pending"], queryFn: () => apiGet<PendingAction[]>("/mikrotik/pending") });
  const retry = useMutation({
    mutationFn: () => apiPost<Record<string, number>>("/mikrotik/pending/retry"),
    onSuccess: (r) => { toast.success(`Retry selesai: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(" · ")}`); qc.invalidateQueries({ queryKey: ["mt-pending"] }); qc.invalidateQueries({ queryKey: ["mt-actions"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = data?.items ?? [];
  const open = pending.filter((p) => p.status === "pending");
  return (
    <div>
      <PageHeader eyebrow="Network" title="MikroTik Action Log" subtitle="Setiap aksi ke MikroTik API tercatat: siapa, router, aksi, username, alasan dan hasil." />
      <Panel title={`Pending MikroTik Action (${open.length})`} className="mb-4" testid="pending-actions-panel"
        actions={can(me, "mikrotik.control") && <Button size="xs" onClick={() => retry.mutate()} disabled={retry.isPending || open.length === 0} data-testid="pending-retry-button"><RotateCw className="h-3.5 w-3.5" />Retry Pending</Button>}>
        {pending.length === 0 ? <div className="text-sm text-muted-foreground">Tidak ada aksi tertunda. Jika router offline, aksi billing → MikroTik masuk antrian di sini dan dijalankan ulang otomatis.</div> : (
          <div className="space-y-1.5">
            {pending.slice(0, 10).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs" data-testid={`pending-row-${p.id}`}>
                <span className="font-mono">{fmtDate(p.created_at, true)}</span><span className="font-mono text-sky-300">{p.username}</span>
                <span>{p.customer_name}</span><span className="text-muted-foreground">{p.router_name}</span><span className="text-muted-foreground">{p.reason}</span>
                <span className="text-muted-foreground">percobaan {p.attempts}</span><span className="ml-auto"><StatusBadge value={p.status} /></span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel>
        <FilterBar>
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Username, pelanggan, admin, alasan…" testid="actions-search-input" />
          <NSelect value={action} onChange={(v) => { setAction(v); setPage(1); }} options={ACTIONS.map((a) => ({ value: a, label: a }))} placeholder="Semua aksi" testid="actions-action-filter" />
          <NSelect value={result} onChange={(v) => { setResult(v); setPage(1); }} options={["SUCCESS", "FAILED", "PENDING", "SKIPPED"].map((a) => ({ value: a, label: a }))} placeholder="Semua hasil" testid="actions-result-filter" />
        </FilterBar>
        <Tbl testid="actions-table" head={["Waktu", "Admin", "Router", "Aksi", "Username", "Alasan", "Hasil", "Pesan"]}>
          {isLoading && <EmptyRow cols={8} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={8} />}
          {rows.map((a) => (
            <tr key={a.id} data-testid={`action-row-${a.id}`}>
              <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmtDate(a.created_at, true)}</td>
              <td className="text-xs">{a.actor}</td>
              <td className="font-mono text-xs">{a.router_name}</td>
              <td className="font-mono text-xs font-semibold">{a.action}</td>
              <td className="font-mono text-xs text-sky-300">{a.username || "-"}</td>
              <td className="text-xs text-muted-foreground">{a.reason}</td>
              <td><StatusBadge value={a.result} /></td>
              <td className="max-w-xs text-xs text-muted-foreground">{a.error_code && <span className="font-mono text-red-400">{a.error_code} </span>}{a.message}</td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={30} onPage={setPage} testid="actions-pager" />
      </Panel>
    </div>
  );
}
