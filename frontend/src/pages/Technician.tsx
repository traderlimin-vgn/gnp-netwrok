import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, MapPin, MessageCircle, Pencil, Play, Users, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dot, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { apiGet, apiPatch, errMsg } from "@/lib/api";
import { fmtDate, mapsUrl, PRIORITY, PSB_STATUS, TICKET_STATUS, useMe, waUrl } from "@/lib/format";
import type { Psb, Ticket, TechnicianBoard } from "@/lib/types";
import { TicketEdit } from "./Tickets";
import { PsbEdit } from "./Psb";

function MapsBtn({ lat, lng, testid }: { lat: number | null; lng: number | null; testid: string }) {
  const url = mapsUrl(lat, lng);
  if (!url) return null;
  return <a href={url} target="_blank" rel="noreferrer" data-testid={testid}><Button size="sm" variant="outline"><MapPin className="h-4 w-4" />Maps</Button></a>;
}

export default function Technician() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({ queryKey: ["technician-board"], queryFn: () => apiGet<TechnicianBoard>("/technician/me") });
  const [editT, setEditT] = useState<Ticket | null>(null);
  const [editP, setEditP] = useState<Psb | null>(null);
  const tStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch<Ticket>(`/tickets/${id}`, { status }),
    onSuccess: (t) => { toast.success(`${t.ticket_no} → ${TICKET_STATUS[t.status]}`); qc.invalidateQueries({ queryKey: ["technician-board"] }); qc.invalidateQueries({ queryKey: ["tickets"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const pStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPatch<Psb>(`/psb/${id}`, { status }),
    onSuccess: (p) => { toast.success(`${p.psb_no} → ${PSB_STATUS[p.status]}`); qc.invalidateQueries({ queryKey: ["technician-board"] }); qc.invalidateQueries({ queryKey: ["psb"] }); },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (isLoading || !data) return <div className="text-sm text-muted-foreground">Memuat tugas…</div>;
  const openT = data.tickets.filter((t) => !["resolved", "closed"].includes(t.status));
  const openP = data.psb.filter((p) => !["done", "cancelled"].includes(p.status));
  const history = [
    ...data.tickets.filter((t) => ["resolved", "closed"].includes(t.status)).map((t) => ({ id: t.id, no: t.ticket_no, name: t.customer_name, what: t.complaint, at: t.resolved_at })),
    ...data.psb.filter((p) => p.status === "done").map((p) => ({ id: p.id, no: p.psb_no, name: p.name, what: `Pasang baru ${p.package_name}`, at: p.created_at })),
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Lapangan" title={me?.role === "teknisi" ? `Halo, ${me.name}` : "Dashboard Teknisi"} subtitle="Tugas lapangan hari ini — terima, kerjakan, upload foto, dan selesaikan." />
      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatCard testid="tech-stat-tickets" label="Tiket aktif" value={openT.length} tone="amber" icon={<Wrench className="h-4 w-4" />} />
        <StatCard testid="tech-stat-psb" label="PSB aktif" value={openP.length} tone="blue" icon={<ClipboardList className="h-4 w-4" />} />
        <StatCard testid="tech-stat-customers" label="Pelanggan" value={data.customers.length} tone="green" icon={<Users className="h-4 w-4" />} />
      </div>
      <Tabs defaultValue="tickets">
        <TabsList className="w-full" data-testid="tech-tabs">
          <TabsTrigger value="tickets" data-testid="tech-tab-tickets">Tiket ({openT.length})</TabsTrigger>
          <TabsTrigger value="psb" data-testid="tech-tab-psb">PSB ({openP.length})</TabsTrigger>
          <TabsTrigger value="customers" data-testid="tech-tab-customers">Pelanggan</TabsTrigger>
          <TabsTrigger value="history" data-testid="tech-tab-history">Riwayat</TabsTrigger>
        </TabsList>
        <TabsContent value="tickets" className="mt-3 space-y-3">
          {openT.length === 0 && <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Tidak ada tiket aktif 🎉</div>}
          {openT.map((t) => (
            <div key={t.id} className="animate-rise rounded-xl border bg-card p-4" data-testid={`tech-ticket-${t.ticket_no}`}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-mono text-xs text-sky-300">{t.ticket_no}</div><div className="font-semibold">{t.customer_name}</div></div>
                <div className="flex flex-col items-end gap-1"><StatusBadge value={t.priority} label={PRIORITY[t.priority]} /><StatusBadge value={t.status} label={TICKET_STATUS[t.status]} /></div>
              </div>
              <p className="mt-2 text-sm">{t.complaint}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.address} · {fmtDate(t.reported_at, true)}</p>
              {t.notes && <p className="mt-1 text-xs italic text-muted-foreground">“{t.notes}”</p>}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {["open", "assigned"].includes(t.status) && <Button size="sm" onClick={() => tStatus.mutate({ id: t.id, status: "in_progress" })} data-testid={`tech-ticket-accept-${t.ticket_no}`}><Play className="h-4 w-4" />Terima</Button>}
                {t.status === "in_progress" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={() => tStatus.mutate({ id: t.id, status: "resolved" })} data-testid={`tech-ticket-resolve-${t.ticket_no}`}><CheckCircle2 className="h-4 w-4" />Selesai</Button>}
                <Button size="sm" variant="outline" onClick={() => setEditT(t)} data-testid={`tech-ticket-edit-${t.ticket_no}`}><Pencil className="h-4 w-4" />Foto/Catatan</Button>
                <MapsBtn lat={t.latitude} lng={t.longitude} testid={`tech-ticket-maps-${t.ticket_no}`} />
                <a href={waUrl(t.whatsapp, `Halo ${t.customer_name}, kami teknisi NETWORK GMP terkait tiket ${t.ticket_no}.`)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline" className="w-full"><MessageCircle className="h-4 w-4" />WA</Button></a>
              </div>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="psb" className="mt-3 space-y-3">
          {openP.length === 0 && <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Tidak ada PSB aktif</div>}
          {openP.map((p) => (
            <div key={p.id} className="animate-rise rounded-xl border bg-card p-4" data-testid={`tech-psb-${p.psb_no}`}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-mono text-xs text-sky-300">{p.psb_no}</div><div className="font-semibold">{p.name}</div></div>
                <StatusBadge value={p.status} label={PSB_STATUS[p.status]} />
              </div>
              <p className="mt-2 text-sm">{p.package_name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{p.address} · Jadwal {fmtDate(p.schedule, true)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {["new", "scheduled"].includes(p.status) && <Button size="sm" onClick={() => pStatus.mutate({ id: p.id, status: "installing" })} data-testid={`tech-psb-start-${p.psb_no}`}><Play className="h-4 w-4" />Mulai Pasang</Button>}
                {p.status === "installing" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={() => pStatus.mutate({ id: p.id, status: "done" })} data-testid={`tech-psb-done-${p.psb_no}`}><CheckCircle2 className="h-4 w-4" />Selesai</Button>}
                <Button size="sm" variant="outline" onClick={() => setEditP(p)} data-testid={`tech-psb-edit-${p.psb_no}`}><Pencil className="h-4 w-4" />Foto/Catatan</Button>
                <MapsBtn lat={p.latitude} lng={p.longitude} testid={`tech-psb-maps-${p.psb_no}`} />
              </div>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="customers" className="mt-3 space-y-2">
          {data.customers.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3" data-testid={`tech-customer-${c.customer_code}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium"><Dot status={c.connection_status} />{c.name}</div>
                <div className="truncate text-xs text-muted-foreground">{c.customer_code} · {c.address} · <span className="font-mono">{c.pppoe_username}</span></div>
              </div>
              <MapsBtn lat={c.latitude} lng={c.longitude} testid={`tech-customer-maps-${c.customer_code}`} />
            </div>
          ))}
        </TabsContent>
        <TabsContent value="history" className="mt-3 space-y-2">
          {history.length === 0 && <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Belum ada riwayat</div>}
          {history.map((h) => (
            <div key={h.id} className="rounded-xl border bg-card p-3 text-sm" data-testid={`tech-history-${h.no}`}>
              <div className="flex justify-between"><span className="font-mono text-xs text-sky-300">{h.no}</span><span className="text-xs text-muted-foreground">{fmtDate(h.at, true)}</span></div>
              <div className="font-medium">{h.name}</div><div className="text-xs text-muted-foreground">{h.what}</div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
      {editT && <TicketEdit t={editT} onClose={() => setEditT(null)} />}
      {editP && <PsbEdit p={editP} onClose={() => setEditP(null)} />}
    </div>
  );
}
