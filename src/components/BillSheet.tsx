// Shared bill / price breakup bottom sheet used by orders, parcels and shop orders.
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ReceiptText } from "lucide-react";

export type BillLine = {
  label: string;
  value: number;
  /** Shown in a lighter style (fees, taxes). */
  muted?: boolean;
  /** Shown in green with a minus sign (discounts). */
  discount?: boolean;
};

export function money(n: number | null | undefined): string {
  return `₹${Number(n ?? 0).toFixed(2)}`;
}

export function BillSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  lines,
  total,
  note,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle?: string | null;
  lines: BillLine[];
  total: number;
  note?: string | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[26px] p-0">
        <div className="mx-auto w-full max-w-md px-5 pb-2 pt-5">
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted" />
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <ReceiptText className="h-5 w-5 text-primary" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground">{title}</h2>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-[18px] border border-border bg-card p-4 text-sm">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className={l.muted ? "text-muted-foreground" : "text-foreground"}>{l.label}</span>
                <span
                  className={
                    l.discount
                      ? "font-semibold text-primary"
                      : l.muted
                        ? "text-muted-foreground"
                        : "font-semibold text-foreground"
                  }
                >
                  {l.discount ? `- ${money(l.value)}` : money(l.value)}
                </span>
              </div>
            ))}
            <div className="my-1 h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">Total</span>
              <span className="text-lg font-extrabold text-primary">{money(total)}</span>
            </div>
          </div>

          {note && <p className="mt-3 text-center text-xs text-muted-foreground">{note}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
