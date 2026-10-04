import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Bell, Boxes, ClipboardList, FileText, Gauge, HardHat, LogOut, Map as MapIcon, Menu, MessageCircle,
  Network, ReceiptText, Router as RouterIcon, ScrollText, Settings as SettingsIcon, ShieldCheck, Users, Wallet, Wrench, BarChart3,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api";
import { endSession } from "@/lib/session";
import { can, fmtDate, ROLE_LABEL } from "@/lib/format";
import type { Me, Notification, Router } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem { to: string; label: string; icon: ReactNode; perm: string; testid: string }
const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Operasional", items: [
    { to: "/", label: "Dashboard", icon: <Gauge />, perm: "dashboard.view", testid: "nav-dashboard" },
    { to: "/customers", label: "Pelanggan", icon: <Users />, perm: "customers.view", testid: "nav-customers" },
    { to: "/packages", label: "Paket Internet", icon: <Boxes />, perm: "customers.view", testid: "nav-packages" },
  ] },
  { title: "Billing & Kas", items: [
    { to: "/invoices", label: "Tagihan", icon: <ReceiptText />, perm: "billing.view", testid: "nav-invoices" },
    { to: "/payments", label: "Pembayaran", icon: <Wallet />, perm: "billing.view", testid: "nav-payments" },
    { to: "/whatsapp", label: "WhatsApp", icon: <MessageCircle />, perm: "billing.view", testid: "nav-whatsapp" },
  ] },
  { title: "Network", items: [
    { to: "/network/routers", label: "MikroTik Routers", icon: <RouterIcon />, perm: "mikrotik.view", testid: "nav-routers" },
    { to: "/network/pppoe", label: "Monitoring PPPoE", icon: <Activity />, perm: "mikrotik.view", testid: "nav-pppoe" },
    { to: "/network/actions", label: "MikroTik Action Log", icon: <ScrollText />, perm: "mikrotik.view", testid: "nav-actions" },
  ] },
  { title: "Lapangan", items: [
    { to: "/tickets", label: "Tiket Gangguan", icon: <Wrench />, perm: "tickets.view", testid: "nav-tickets" },
    { to: "/psb", label: "PSB — Pasang Baru", icon: <ClipboardList />, perm: "psb.view", testid: "nav-psb" },
    { to: "/technician", label: "Dashboard Teknisi", icon: <HardHat />, perm: "technician.view", testid: "nav-technician" },
    { to: "/map", label: "Peta Jaringan", icon: <MapIcon />, perm: "map.view", testid: "nav-map" },
  ] },
  { title: "Laporan & Audit", items: [
    { to: "/reports", label: "Laporan", icon: <BarChart3 />, perm: "reports.view", testid: "nav-reports" },
    { to: "/audit", label: "Audit Log", icon: <ShieldCheck />, perm: "audit.view", testid: "nav-audit" },
  ] },
  { title: "Pengaturan", items: [
    { to: "/settings", label: "Pengaturan", icon: <SettingsIcon />, perm: "settings.manage", testid: "nav-settings" },
  ] },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-4 py-4" data-testid="brand-link">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-sky-600 shadow-[0_0_18px_rgba(2,132,199,0.45)]">
        <Network className="h-5 w-5 text-white" />
      </div>
      <div className="leading-tight">
        <div className="font-heading text-[15px] font-bold tracking-wide text-white">NETWORK GMP</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">ISP Billing NOC</div>
      </div>
    </Link>
  );
}

function SidebarNav({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-6">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => can(me, i.perm));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{g.title}</div>
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} onClick={onNavigate} data-testid={i.testid}
                className={({ isActive }) => cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-[background-color,color] duration-150 [&_svg]:h-4 [&_svg]:w-4",
                  isActive ? "bg-sky-600 text-white shadow-[0_0_15px_rgba(2,132,199,0.25)]" : "text-slate-400 hover:bg-slate-800/60 hover:text-white")}>
                {i.icon}{i.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["notifications"], queryFn: () => apiGet<Notification[]>("/notifications"), refetchInterval: 60_000 });
  const unread = data.filter((n) => !n.read).length;
  const readAll = useMutation({ mutationFn: () => apiPost("/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" data-testid="notifications-button" />}>
        <Bell />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white" data-testid="notifications-unread-count">{unread}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifikasi</span>
          <Button size="xs" variant="ghost" onClick={() => readAll.mutate()} data-testid="notifications-read-all">Tandai dibaca</Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {data.length === 0 && <div className="p-4 text-sm text-muted-foreground">Belum ada notifikasi</div>}
          {data.map((n) => (
            <div key={n.id} className={cn("border-b px-3 py-2 text-xs", !n.read && "bg-sky-500/5")}>
              <div className="font-semibold">{n.title}</div>
              <div className="text-muted-foreground">{n.message}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground/70">{fmtDate(n.created_at, true)}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RouterPill({ me }: { me: Me }) {
  const { data } = useQuery({ queryKey: ["routers"], queryFn: () => apiGet<Router[]>("/mikrotik/routers"), enabled: can(me, "mikrotik.view"), refetchInterval: 60_000 });
  if (!data) return null;
  const on = data.filter((r) => r.status === "online").length;
  return (
    <Link to="/network/routers" data-testid="header-router-status" className="hidden items-center gap-3 rounded-full border bg-card/60 px-3 py-1 text-xs sm:flex">
      <span className="text-muted-foreground">MikroTik</span>
      <span className="flex items-center gap-1 text-emerald-400"><span className="h-2 w-2 rounded-full bg-emerald-400" />{on} Online</span>
      <span className="flex items-center gap-1 text-red-400"><span className="h-2 w-2 rounded-full bg-red-500" />{data.length - on} Offline</span>
    </Link>
  );
}

const MOBILE_TECH = [
  { to: "/technician", label: "Tugas", icon: <HardHat className="h-5 w-5" /> },
  { to: "/tickets", label: "Tiket", icon: <Wrench className="h-5 w-5" /> },
  { to: "/map", label: "Peta", icon: <MapIcon className="h-5 w-5" /> },
  { to: "/customers", label: "Pelanggan", icon: <FileText className="h-5 w-5" /> },
];

export default function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const isTech = me.role === "teknisi";
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-800/80 bg-[#070A10] lg:flex">
        <Brand />
        <SidebarNav me={me} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-slate-800 bg-[#070A10] p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Brand />
          <SidebarNav me={me} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-800/80 bg-[#0B0F17]/85 px-3 backdrop-blur-xl md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} data-testid="mobile-menu-button"><Menu /></Button>
          <div className="hidden text-xs text-muted-foreground md:block">
            <span className="font-mono">{new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <RouterPill me={me} />
            <Notifications />
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-xs font-semibold" data-testid="header-user-name">{me.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-sky-400" data-testid="header-user-role">{ROLE_LABEL[me.role]}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => endSession()} data-testid="logout-button" title="Keluar"><LogOut /></Button>
          </div>
        </header>
        <main key={loc.pathname} className={cn("flex-1 px-3 py-5 md:px-6 md:py-6", isTech && "pb-24 lg:pb-6")}>{children}</main>
      </div>
      {isTech && (
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-800 bg-[#070A10]/95 backdrop-blur lg:hidden" data-testid="technician-bottom-nav">
          {MOBILE_TECH.map((i) => (
            <NavLink key={i.to} to={i.to} data-testid={`tech-nav-${i.label.toLowerCase()}`}
              className={({ isActive }) => cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px]", isActive ? "text-sky-400" : "text-slate-400")}>
              {i.icon}{i.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
