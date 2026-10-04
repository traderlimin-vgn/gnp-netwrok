import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Lock, Network, ShieldCheck, Zap, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost, errMsg } from "@/lib/api";
import { beginSession } from "@/lib/session";
import { queryClient } from "@/lib/queryClient";
import type { Me } from "@/lib/types";

const DEMO = [
  ["Super Admin", "superadmin@networkgmp.id"], ["Admin", "admin@networkgmp.id"], ["Finance", "finance@networkgmp.id"],
  ["CS", "cs@networkgmp.id"], ["Teknisi", "teknisi1@networkgmp.id"], ["Supervisor", "supervisor@networkgmp.id"],
];

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () => apiPost<Me>("/auth/login", { email, password }),
    onSuccess: (me) => {
      beginSession();
      queryClient.setQueryData(["me"], me);
      toast.success(`Selamat datang, ${me.name}`);
      nav(me.role === "teknisi" ? "/technician" : "/", { replace: true });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="grid min-h-screen bg-[#0B0F17] lg:grid-cols-[1.15fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-slate-800 bg-[#070A10] p-10 lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#38bdf8 1px, transparent 1px), linear-gradient(90deg, #38bdf8 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
        <div className="relative flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-sky-600 shadow-[0_0_24px_rgba(2,132,199,0.5)]"><Network className="h-6 w-6 text-white" /></div>
          <div>
            <div className="font-heading text-xl font-bold tracking-wide text-white">NETWORK GMP</div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Billing Management System</div>
          </div>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="font-heading text-5xl font-semibold leading-[1.05] text-white">Billing, MikroTik &amp; lapangan dalam satu konsol NOC.</h1>
          <p className="mt-4 text-slate-400">Tagihan otomatis, isolir &amp; aktivasi via MikroTik API, monitoring PPPoE, tiket gangguan dan PSB untuk RT/RW Net.</p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {[[<ShieldCheck key="a" />, "MikroTik API", "Kredensial terenkripsi"], [<Zap key="b" />, "Auto Isolir", "Idempoten & fail-safe"], [<Radio key="c" />, "PPPoE Live", "Polling 30–60 detik"]].map(([ic, t, d]) => (
              <div key={String(t)} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <div className="text-sky-400 [&_svg]:h-4 [&_svg]:w-4">{ic}</div>
                <div className="mt-2 text-sm font-semibold text-white">{t}</div>
                <div className="text-[11px] text-slate-500">{d}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-10 h-px w-full overflow-hidden bg-slate-800"><div className="animate-scan h-px w-1/3 bg-sky-500" /></div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form className="w-full max-w-sm animate-rise" onSubmit={(e) => { e.preventDefault(); login.mutate(); }} data-testid="login-form">
          <div className="mb-6 lg:hidden flex items-center gap-2">
            <Network className="h-6 w-6 text-sky-500" /><span className="font-heading text-lg font-bold">NETWORK GMP</span>
          </div>
          <h2 className="text-2xl font-semibold">Masuk ke konsol</h2>
          <p className="mt-1 text-sm text-muted-foreground">Gunakan akun sesuai role Anda.</p>
          <div className="mt-6 space-y-3">
            <Input data-testid="login-email-input" type="email" required placeholder="email@networkgmp.id" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
            <Input data-testid="login-password-input" type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
            <Button data-testid="login-submit-button" type="submit" className="h-10 w-full" disabled={login.isPending}>
              <Lock />{login.isPending ? "Memeriksa…" : "Masuk"}
            </Button>
          </div>
          <div className="mt-8 rounded-xl border bg-card/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Akun demo · password Gmp@2026!</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {DEMO.map(([label, em]) => (
                <button type="button" key={em} data-testid={`demo-role-${label.toLowerCase().replace(" ", "-")}`}
                  onClick={() => { setEmail(em); setPassword("Gmp@2026!"); }}
                  className="rounded-md border px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-sky-500/40 hover:text-foreground">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
