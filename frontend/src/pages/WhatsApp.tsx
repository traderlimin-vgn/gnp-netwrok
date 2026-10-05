import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyRow, Field, NSelect, PageHeader, Pager, Panel, SearchInput, StatusBadge } from "@/components/common";
import { FilterBar, Tbl } from "@/components/kit";
import { apiGet, apiPost, errMsg } from "@/lib/api";
import { can, fmtDate, useMe } from "@/lib/format";
import type { Paged, WaConfig, WhatsAppMessage } from "@/lib/types";

const TEMPLATES = ["invoice", "payment", "isolir", "activation", "ticket_technician", "psb_technician", "manual"];

export default function WhatsApp() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: cfg } = useQuery({ queryKey: ["wa-config"], queryFn: () => apiGet<WaConfig>("/whatsapp/config") });
  const [q, setQ] = useState("");
  const [template, setTemplate] = useState("");
  const [page, setPage] = useState(1);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const params = new URLSearchParams({ q, template, page: String(page), limit: "30" });
  const { data, isLoading } = useQuery({ queryKey: ["whatsapp", params.toString()], queryFn: () => apiGet<Paged<WhatsAppMessage>>(`/whatsapp/messages?${params}`) });
  const send = useMutation({
    mutationFn: () => apiPost<WhatsAppMessage>("/whatsapp/send", { to, message }),
    onSuccess: (m) => { toast.success(`Pesan ${m.status} via ${m.provider}`); setMessage(""); qc.invalidateQueries({ queryKey: ["whatsapp"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = data?.items ?? [];
  return (
    <div>
      <PageHeader eyebrow="Billing & Kas" title="WhatsApp Gateway"
        subtitle={cfg?.provider === "fonnte"
          ? "Mode: FONNTE — pesan dikirim dari nomor WhatsApp pribadi yang dipasangkan. Atur token & tes di Pengaturan → WhatsApp."
          : "Mode: SIMULATOR (pesan dicatat, tidak dikirim ke WhatsApp asli). Aktifkan Fonnte di Pengaturan → WhatsApp untuk mengirim dari nomor pribadi."}
        actions={<StatusBadge value={cfg?.provider === "fonnte" ? "active" : "pending"} label={cfg?.provider === "fonnte" ? "FONNTE AKTIF" : "SIMULATOR"} testid="wa-provider-badge" />} />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Panel title="Riwayat Pesan">
          <FilterBar>
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Nomor, nama, isi pesan…" testid="wa-search-input" />
            <NSelect value={template} onChange={(v) => { setTemplate(v); setPage(1); }} options={TEMPLATES.map((t) => ({ value: t, label: t }))} placeholder="Semua template" testid="wa-template-filter" />
          </FilterBar>
          <Tbl testid="wa-table" head={["Waktu", "Tujuan", "Template", "Pesan", "Status"]}>
            {isLoading && <EmptyRow cols={5} text="Memuat…" />}
            {!isLoading && rows.length === 0 && <EmptyRow cols={5} />}
            {rows.map((m) => (
              <tr key={m.id} data-testid={`wa-row-${m.id}`}>
                <td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{fmtDate(m.created_at, true)}</td>
                <td><div className="text-sm">{m.name || "-"}</div><div className="font-mono text-xs text-muted-foreground">{m.to}</div></td>
                <td><StatusBadge value="new" label={m.template} /></td>
                <td className="max-w-md"><div className="line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{m.message}</div></td>
                <td><StatusBadge value={m.status} />{m.error && <div className="text-[10px] text-red-400">{m.error}</div>}</td>
              </tr>
            ))}
          </Tbl>
          <Pager page={page} total={data?.total ?? 0} limit={30} onPage={setPage} testid="wa-pager" />
        </Panel>
        {can(me, "whatsapp.send") && (
          <Panel title="Kirim Pesan Manual" testid="wa-send-panel">
            <div className="space-y-3">
              <Field label="Nomor WhatsApp" hint="Format 628xxxxxxxxx"><Input value={to} onChange={(e) => setTo(e.target.value)} className="font-mono" data-testid="wa-to-input" /></Field>
              <Field label="Pesan"><Textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="wa-message-input" /></Field>
              <Button className="w-full" onClick={() => send.mutate()} disabled={!to || !message || send.isPending} data-testid="wa-send-button"><Send className="h-4 w-4" />Kirim</Button>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
