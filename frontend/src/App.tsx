import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/AppShell";
import { can, useMe } from "@/lib/format";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Customers from "@/pages/Customers";
import Packages from "@/pages/Packages";
import Invoices from "@/pages/Invoices";
import Payments from "@/pages/Payments";
import WhatsApp from "@/pages/WhatsApp";
import Routers from "@/pages/Routers";
import Pppoe from "@/pages/Pppoe";
import ActionLog from "@/pages/ActionLog";
import Tickets from "@/pages/Tickets";
import PsbPage from "@/pages/Psb";
import Technician from "@/pages/Technician";
import NetworkMap from "@/pages/NetworkMap";
import Reports from "@/pages/Reports";
import Audit from "@/pages/Audit";
import SettingsPage from "@/pages/Settings";
import Acs from "@/pages/Acs";

function Protected({ perm, children }: { perm: string; children: ReactNode }) {
  const { data: me, isLoading, isError } = useMe();
  const loc = useLocation();
  if (isLoading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Memuat NETWORK GMP…</div>;
  if (isError || !me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.role === "teknisi" && loc.pathname === "/") return <Navigate to="/technician" replace />;
  return (
    <AppShell me={me}>
      {can(me, perm) ? children : (
        <div className="rounded-xl border bg-card p-10 text-center" data-testid="forbidden-message">
          <div className="text-lg font-semibold">403 — Akses ditolak</div>
          <p className="mt-1 text-sm text-muted-foreground">Role Anda tidak memiliki akses ke halaman ini.</p>
        </div>
      )}
    </AppShell>
  );
}

const ROUTES: [string, string, ReactNode][] = [
  ["/", "dashboard.view", <Dashboard />],
  ["/customers", "customers.view", <Customers />],
  ["/packages", "customers.view", <Packages />],
  ["/invoices", "billing.view", <Invoices />],
  ["/payments", "billing.view", <Payments />],
  ["/whatsapp", "billing.view", <WhatsApp />],
  ["/network/routers", "mikrotik.view", <Routers />],
  ["/network/pppoe", "mikrotik.view", <Pppoe />],
  ["/network/actions", "mikrotik.view", <ActionLog />],
  ["/network/acs", "mikrotik.view", <Acs />],
  ["/tickets", "tickets.view", <Tickets />],
  ["/psb", "psb.view", <PsbPage />],
  ["/technician", "technician.view", <Technician />],
  ["/map", "map.view", <NetworkMap />],
  ["/reports", "reports.view", <Reports />],
  ["/audit", "audit.view", <Audit />],
  ["/settings", "settings.manage", <SettingsPage />],
];

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        {ROUTES.map(([path, perm, el]) => <Route key={path} path={path} element={<Protected perm={perm}>{el}</Protected>} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors />
    </>
  );
}
