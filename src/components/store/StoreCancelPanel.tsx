import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CancellationPolicySheet } from "@/components/CancellationPolicySheet";
import { useLanguage } from "@/i18n";
import { useBackHandler } from "@/lib/backHandler";
import { cancelStoreOrderTo, fetchStoreCancelQuote, type RefundDestination } from "@/lib/cancellation";

const TXT = {
  en: {
    cancel: "Cancel order", help: "Need help?", policy: "Cancellation policy",
    title: "Cancel this order?", back: "You'll get back ₹{n}", noPay: "No payment was taken for this order.",
    where: "Where should the refund go?", original: "Original payment method", originalSub: "5–7 working days",
    wallet: "badiyos Wallet", walletSub: "Instant", confirm: "Confirm cancel", keep: "Keep order",
    done: "Order cancelled", failed: "Couldn't cancel. Please try again.",
  },
  mr: {
    cancel: "ऑर्डर रद्द करा", help: "मदत हवी?", policy: "रद्द करण्याचे धोरण",
    title: "ही ऑर्डर रद्द करायची?", back: "तुम्हाला ₹{n} परत मिळतील", noPay: "या ऑर्डरसाठी कोणतेही पेमेंट घेतले नाही.",
    where: "परतावा कुठे हवा?", original: "मूळ पेमेंट पद्धत", originalSub: "५–७ कामकाजाचे दिवस",
    wallet: "badiyos वॉलेट", walletSub: "लगेच", confirm: "रद्द करा", keep: "ऑर्डर ठेवा",
    done: "ऑर्डर रद्द झाली", failed: "रद्द करता आले नाही. पुन्हा प्रयत्न करा.",
  },
};

/** Cancel / Need help / policy block for a Store or Food order. */
export function StoreCancelPanel({ orderId, orderNumber, serviceKey, onOpenHelp }: {
  orderId: string;
  orderNumber: string;
  serviceKey: "store" | "food";
  onOpenHelp?: (orderRef: string) => void;
}) {
  const { lang } = useLanguage();
  const mr = lang === "mr";
  const s = TXT[mr ? "mr" : "en"];
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [dest, setDest] = useState<RefundDestination>("original");
  const [busy, setBusy] = useState(false);
  useBackHandler(open, () => setOpen(false));

  const { data: q } = useQuery({
    queryKey: ["store-cancel-quote", orderId],
    queryFn: () => fetchStoreCancelQuote(orderId),
    staleTime: 0,
    refetchInterval: 15_000,
  });

  async function confirm() {
    setBusy(true);
    try {
      await cancelStoreOrderTo(orderId, dest, "CUSTOMER_CANCELLED");
      toast.success(s.done);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["store-order", orderId] });
      void qc.invalidateQueries({ queryKey: ["store-cancel-quote", orderId] });
      void qc.invalidateQueries({ queryKey: ["wallet"] });
    } catch {
      toast.error(s.failed);
    } finally {
      setBusy(false);
    }
  }

  const refund = Number(q?.refund_total ?? 0);
  const msg = mr ? q?.message_mr || q?.message_en : q?.message_en;

  return (
    <div className="rounded-[22px] border border-border bg-card p-4">
      {q?.can_cancel ? (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full rounded-[14px] border border-destructive/40 py-3 text-sm font-extrabold text-destructive">
          {s.cancel}
        </button>
      ) : q ? (
        <>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
          <button type="button" onClick={() => onOpenHelp?.(`Order #${orderNumber}`)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] bg-primary/10 py-3 text-sm font-extrabold text-primary">
            <MessageCircle className="h-4 w-4" /> {s.help}
          </button>
        </>
      ) : null}
      <button type="button" onClick={() => setPolicy(true)}
        className="mt-3 flex w-full items-center justify-between text-sm font-bold text-primary">
        {s.policy} <ChevronRight className="h-4 w-4" />
      </button>

      <CancellationPolicySheet open={policy} onClose={() => setPolicy(false)} serviceKey={serviceKey} />

      <Sheet open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <SheetContent side="bottom" className="rounded-t-[24px] px-5 pb-6 safe-bottom">
          <SheetTitle className="mt-2 text-lg font-extrabold text-foreground">{s.title}</SheetTitle>
          <p className="mt-2 text-sm font-bold text-primary">{refund > 0 ? s.back.replace("{n}", String(Math.round(refund * 100) / 100)) : s.noPay}</p>
          {refund > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-bold text-foreground">{s.where}</p>
              {(["original", "wallet"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDest(d)}
                  className={"flex w-full items-center justify-between rounded-[14px] border p-3 text-left " + (dest === d ? "border-primary bg-primary/5" : "border-border")}>
                  <span>
                    <span className="block text-sm font-bold text-foreground">{d === "wallet" ? s.wallet : s.original}</span>
                    <span className="block text-xs text-muted-foreground">{d === "wallet" ? s.walletSub : s.originalSub}</span>
                  </span>
                  <span className={"h-4 w-4 rounded-full border-2 " + (dest === d ? "border-primary bg-primary" : "border-border")} />
                </button>
              ))}
            </div>
          )}
          <div className="mt-5 flex gap-3">
            <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-[14px] border border-border py-3 text-sm font-bold text-foreground">{s.keep}</button>
            <button type="button" disabled={busy} onClick={() => void confirm()}
              className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-destructive py-3 text-sm font-extrabold text-destructive-foreground disabled:opacity-60">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{s.confirm}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
