import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";
import { useBackHandler } from "@/lib/backHandler";
import { getErrorMessage } from "@/lib/errorMessage";
import { cancelBookingTo, fetchCancelQuote, num, type CancelQuote, type RefundDestination } from "@/lib/cancellation";

const T = {
  en: {
    title: "Cancel booking?", checking: "Checking your refund…", back: "You'll get back ₹{r} — {p}% fee",
    full: "Full refund — ₹{r}", none: "No refund", noneSub: "Nothing will be returned for this booking.",
    where: "Where should we send ₹{r}?", wallet: "badiyos Wallet", walletSub: "Instant, use on your next booking (can't be withdrawn to bank)",
    orig: "Original payment method", origSub: "5–7 working days", keep: "Keep booking", next: "Continue", confirm: "Yes, cancel",
    cancelling: "Cancelling…", doneWallet: "Booking cancelled. ₹{r} added to your badiyos Wallet.",
    doneOrig: "Booking cancelled. ₹{r} will reach your original payment method in 5–7 working days.", done: "Booking cancelled.",
    cannot: "This booking can no longer be cancelled.",
  },
  mr: {
    title: "बुकिंग रद्द करायचे?", checking: "परतावा तपासत आहोत…", back: "तुम्हाला ₹{r} परत मिळतील — {p}% शुल्क",
    full: "पूर्ण परतावा — ₹{r}", none: "परतावा नाही", noneSub: "या बुकिंगसाठी काहीही परत मिळणार नाही.",
    where: "₹{r} कुठे पाठवायचे?", wallet: "badiyos वॉलेट", walletSub: "लगेच, पुढच्या बुकिंगसाठी वापरा (बँकेत काढता येणार नाही)",
    orig: "मूळ पेमेंट पद्धत", origSub: "५–७ कामकाजाचे दिवस", keep: "बुकिंग ठेवा", next: "पुढे", confirm: "हो, रद्द करा",
    cancelling: "रद्द करत आहोत…", doneWallet: "बुकिंग रद्द झाले. ₹{r} तुमच्या badiyos वॉलेटमध्ये जमा झाले.",
    doneOrig: "बुकिंग रद्द झाले. ₹{r} ५–७ कामकाजाच्या दिवसांत मूळ पेमेंट पद्धतीत येतील.", done: "बुकिंग रद्द झाले.",
    cannot: "हे बुकिंग आता रद्द करता येत नाही.",
  },
};
const f = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const rs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Two-step cancel: refund quote, then refund destination. */
export function CancelRefundDialog({ bookingId, open, onClose, onCancelled }: {
  bookingId: string | null; open: boolean; onClose: () => void; onCancelled: (dest: RefundDestination | null) => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? T.mr : T.en;
  const [quote, setQuote] = useState<CancelQuote | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [dest, setDest] = useState<RefundDestination>("original");
  const [busy, setBusy] = useState(false);
  useBackHandler(open, () => !busy && onClose());

  useEffect(() => {
    if (!open || !bookingId) return;
    setQuote(null); setStep(1); setDest("original");
    let alive = true;
    fetchCancelQuote(bookingId).then((q) => alive && setQuote(q)).catch(async (e) => {
      if (!alive) return;
      toast.error(await getErrorMessage(e)); onClose();
    });
    return () => { alive = false; };
  }, [open, bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const paid = num(quote, "total_paid") ?? 0;
  const refund = num(quote, "refund") ?? 0;
  const fee = num(quote, "fee") ?? 0;
  const pct = paid > 0 ? Math.round((fee / paid) * 100) : 0;
  const canCancel = quote?.can_cancel !== false;

  const go = async () => {
    if (!bookingId || busy) return;
    setBusy(true);
    try {
      const d: RefundDestination = refund > 0 ? dest : "original";
      await cancelBookingTo(bookingId, d);
      toast.success(refund > 0 ? f(d === "wallet" ? s.doneWallet : s.doneOrig, { r: rs(refund) }) : s.done);
      onCancelled(refund > 0 ? d : null);
    } catch (e) {
      toast.error(await getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const Opt = ({ k, title, sub }: { k: RefundDestination; title: string; sub: string }) => (
    <button type="button" onClick={() => setDest(k)}
      className={`flex w-full items-start gap-3 rounded-[14px] border-2 p-3 text-left ${dest === k ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${dest === k ? "border-primary" : "border-muted-foreground"}`}>
        {dest === k && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </span>
      <span><span className="block text-sm font-extrabold text-foreground">{title}</span><span className="block text-xs text-muted-foreground">{sub}</span></span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/50 sm:items-center">
      <div className="w-full max-w-md rounded-t-[24px] bg-card p-5 safe-bottom sm:rounded-[20px]">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-extrabold text-foreground">{step === 2 ? f(s.where, { r: rs(refund) }) : s.title}</h2>
          <button onClick={() => !busy && onClose()} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
            <X className="h-4 w-4 text-foreground" />
          </button>
        </div>
        {!quote ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{s.checking}</p>
        ) : !canCancel ? (
          <p className="mt-3 text-sm text-muted-foreground">{s.cannot}</p>
        ) : step === 1 ? (
          <div className="mt-3">
            {refund <= 0 ? (
              <><p className="text-sm font-extrabold text-foreground">{s.none}</p><p className="mt-0.5 text-xs text-muted-foreground">{s.noneSub}</p></>
            ) : fee > 0 ? (
              <p className="text-sm font-extrabold text-foreground">{f(s.back, { r: rs(refund), p: pct })}</p>
            ) : (
              <p className="text-sm font-extrabold text-primary">{f(s.full, { r: rs(refund) })}</p>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <Opt k="wallet" title={s.wallet} sub={s.walletSub} />
            <Opt k="original" title={s.orig} sub={s.origSub} />
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <button onClick={() => (step === 2 ? setStep(1) : onClose())} disabled={busy}
            className="flex-1 rounded-[14px] border border-border bg-card px-4 py-3 text-sm font-bold text-foreground">{s.keep}</button>
          {quote && canCancel && (
            <button disabled={busy} onClick={() => (step === 1 && refund > 0 ? setStep(2) : void go())}
              className="flex-1 rounded-[14px] bg-destructive px-4 py-3 text-sm font-bold text-destructive-foreground disabled:opacity-70">
              {busy ? s.cancelling : step === 1 && refund > 0 ? s.next : s.confirm}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function refundDestinationLabel(dest: string | null | undefined, lang: string): string | null {
  if (dest === "wallet") return lang === "mr" ? "badiyos वॉलेट" : "badiyos Wallet";
  if (dest === "original") return lang === "mr" ? "मूळ पेमेंट पद्धत" : "Original payment method";
  return null;
}
