import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Modal({ open, onClose, title, description, children, footer, wide, testid }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean; testid: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid={testid} className={cn("max-h-[92vh] overflow-y-auto", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

export function Tbl({ head, children, testid }: { head: ReactNode[]; children: ReactNode; testid: string }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-testid={testid}>
        <thead>
          <tr className="border-b text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border/60 [&>tr]:transition-colors [&>tr:hover]:bg-sky-500/[0.04] [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-middle">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/** Button that asks for confirmation before running an action. */
export function ConfirmButton({ label, title, message, onConfirm, testid, variant = "outline", size = "xs", disabled, icon }: {
  label: ReactNode; title: string; message: string; onConfirm: () => void; testid: string;
  variant?: "outline" | "destructive" | "default" | "ghost" | "secondary"; size?: "xs" | "sm" | "default"; disabled?: boolean; icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} disabled={disabled} onClick={() => setOpen(true)} data-testid={testid}>{icon}{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} testid={`${testid}-dialog`}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid={`${testid}-cancel`}>Batal</Button>
          <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={() => { setOpen(false); onConfirm(); }} data-testid={`${testid}-confirm`}>Ya, lanjutkan</Button>
        </>}>
        <p className="text-sm text-muted-foreground">{message}</p>
      </Modal>
    </>
  );
}

export function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("text-right", mono && "font-mono text-xs")}>{v || "-"}</span>
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}
