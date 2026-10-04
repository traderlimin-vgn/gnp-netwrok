import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between animate-rise">
      <div>
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold md:text-3xl" data-testid="page-title">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-500/12 text-emerald-400 ring-emerald-500/25",
  red: "bg-red-500/12 text-red-400 ring-red-500/25",
  amber: "bg-amber-500/12 text-amber-300 ring-amber-500/25",
  blue: "bg-sky-500/12 text-sky-300 ring-sky-500/25",
  slate: "bg-slate-500/15 text-slate-300 ring-slate-500/25",
  violet: "bg-violet-500/12 text-violet-300 ring-violet-500/25",
};

const STATUS_TONE: Record<string, string> = {
  active: "green", paid: "green", online: "green", confirmed: "green", SUCCESS: "green", resolved: "green", done: "green", sent: "green", OK: "green", closed: "slate",
  isolir: "red", overdue: "red", offline: "red", FAILED: "red", critical: "red", failed: "red", MIKROTIK_SYNC_FAILED: "red",
  suspend: "amber", unpaid: "amber", pending: "amber", PENDING: "amber", high: "amber", in_progress: "amber", installing: "amber", MIKROTIK_OFFLINE: "amber",
  connecting: "blue", assigned: "blue", scheduled: "blue", medium: "blue", new: "blue", open: "blue",
  stopped: "slate", cancelled: "slate", unknown: "slate", SKIPPED: "slate", low: "slate", NOT_LINKED: "slate",
};

export function StatusBadge({ value, label, testid }: { value: string; label?: string; testid?: string }) {
  const tone = TONES[STATUS_TONE[value] ?? "slate"];
  return (
    <span data-testid={testid} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset", tone)}>
      {label ?? value}
    </span>
  );
}

export function Dot({ status }: { status: string }) {
  const c = { online: "bg-emerald-400", offline: "bg-red-500", connecting: "bg-amber-400", unknown: "bg-slate-500" }[status] ?? "bg-slate-500";
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {status === "online" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", c)} />
    </span>
  );
}

export function StatCard({ label, value, icon, hint, tone = "blue", testid, className }: {
  label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode; tone?: keyof typeof TONES; testid?: string; className?: string;
}) {
  return (
    <div data-testid={testid} className={cn("group relative overflow-hidden rounded-xl border bg-card p-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-sky-500/30", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
        {icon && <div className={cn("rounded-lg p-1.5 ring-1 ring-inset", TONES[tone])}>{icon}</div>}
      </div>
      <div className="mt-2 font-heading text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, testid }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; testid?: string }) {
  return (
    <section data-testid={testid} className={cn("rounded-xl border bg-card animate-rise", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function SearchInput({ value, onChange, placeholder = "Cari…", testid }: { value: string; onChange: (v: string) => void; placeholder?: string; testid: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8" />
    </div>
  );
}

export interface Opt { value: string; label: string }

export function NSelect({ value, onChange, options, testid, className, placeholder }: {
  value: string; onChange: (v: string) => void; options: Opt[]; testid: string; className?: string; placeholder?: string;
}) {
  return (
    <select
      data-testid={testid}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/40 dark:bg-input/30 [&>option]:bg-popover", className)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

export function Pager({ page, total, limit, onPage, testid }: { page: number; total: number; limit: number; onPage: (p: number) => void; testid: string }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-xs text-muted-foreground" data-testid={testid}>
      <span>{total} data · halaman {page}/{pages}</span>
      <div className="flex gap-1">
        <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testid}-prev`}><ChevronLeft /></Button>
        <Button size="icon-sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid={`${testid}-next`}><ChevronRight /></Button>
      </div>
    </div>
  );
}

export function EmptyRow({ cols, text = "Belum ada data" }: { cols: number; text?: string }) {
  return (
    <tr><td colSpan={cols} className="py-10 text-center text-sm text-muted-foreground">{text}</td></tr>
  );
}

export const mono = "font-mono text-xs";
