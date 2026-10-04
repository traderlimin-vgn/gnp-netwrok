import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyRow, PageHeader, Pager, Panel, SearchInput } from "@/components/common";
import { FilterBar, Tbl } from "@/components/kit";
import { apiGet } from "@/lib/api";
import { fmtDate, ROLE_LABEL } from "@/lib/format";
import type { AuditLog, Paged, Role } from "@/lib/types";

export default function Audit() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q, page: String(page), limit: "30" });
  const { data, isLoading } = useQuery({ queryKey: ["audit", params.toString()], queryFn: () => apiGet<Paged<AuditLog>>(`/audit-logs?${params}`) });
  const rows = data?.items ?? [];
  return (
    <div>
      <PageHeader eyebrow="Laporan & Audit" title="Audit Log" subtitle="Login, logout, perubahan pelanggan, pembayaran, invoice, isolir, aktivasi, PPPoE, sync dan konfigurasi router." />
      <Panel>
        <FilterBar><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Aksi, user, detail…" testid="audit-search-input" /></FilterBar>
        <Tbl testid="audit-table" head={["Waktu", "User", "Role", "Aksi", "Entitas", "Detail", "IP"]}>
          {isLoading && <EmptyRow cols={7} text="Memuat…" />}
          {!isLoading && rows.length === 0 && <EmptyRow cols={7} />}
          {rows.map((a) => (
            <tr key={a.id} data-testid={`audit-row-${a.id}`}>
              <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmtDate(a.created_at, true)}</td>
              <td className="text-xs">{a.actor}</td>
              <td className="text-xs text-sky-300">{ROLE_LABEL[a.role as Role] ?? a.role}</td>
              <td className="font-mono text-xs font-semibold">{a.action}</td>
              <td className="text-xs">{a.entity}</td>
              <td className="max-w-sm text-xs text-muted-foreground">{a.detail}</td>
              <td className="font-mono text-xs text-muted-foreground">{a.ip}</td>
            </tr>
          ))}
        </Tbl>
        <Pager page={page} total={data?.total ?? 0} limit={30} onPage={setPage} testid="audit-pager" />
      </Panel>
    </div>
  );
}
