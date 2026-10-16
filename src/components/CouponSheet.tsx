/** Shared "Apply coupon" bottom sheet for Clean, Store and Food checkouts. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Tag, X } from "lucide-react";
import { useLanguage } from "@/i18n";
import { useBackHandler } from "@/lib/backHandler";
import { fetchCheckoutCoupons, previewCoupon, type AppliedCoupon, type CheckoutCoupon } from "@/lib/coupons";

const T = {
  en: {
    title: "Apply coupon", ph: "Enter coupon code", apply: "Apply", applied: "Applied", available: "Available coupons",
    unavailable: "Not available for this order", none: "No coupons for you right now", min: "Min order ₹{n}", save: "You save ₹{n}",
    r: {
      min_order: "Add ₹{n} more to use this", not_applicable: "Not valid for this service", not_eligible: "Not available on your account",
      already_used: "Already used", expired: "Expired", exhausted: "Fully claimed", no_discount: "No saving on this order",
      invalid_code: "That code isn't valid", too_many_attempts: "Too many wrong codes. Try again in 10 minutes.", other: "Can't be used right now",
      first: "Only on your first order", existing: "Only after your first completed order",
    },
  },
  mr: {
    title: "कूपन लावा", ph: "कूपन कोड टाका", apply: "लावा", applied: "लावले", available: "उपलब्ध कूपन",
    unavailable: "या ऑर्डरसाठी उपलब्ध नाही", none: "सध्या तुमच्यासाठी कूपन नाहीत", min: "किमान ऑर्डर ₹{n}", save: "तुमची ₹{n} बचत",
    r: {
      min_order: "हे वापरण्यासाठी आणखी ₹{n} जोडा", not_applicable: "या सेवेसाठी लागू नाही", not_eligible: "तुमच्या खात्यासाठी उपलब्ध नाही",
      already_used: "आधीच वापरले", expired: "मुदत संपली", exhausted: "सर्व वापरले गेले", no_discount: "या ऑर्डरवर बचत नाही",
      invalid_code: "हा कोड चुकीचा आहे", too_many_attempts: "खूप चुकीचे कोड. 10 मिनिटांनी पुन्हा प्रयत्न करा.", other: "सध्या वापरता येत नाही",
      first: "फक्त पहिल्या ऑर्डरवर", existing: "पहिली ऑर्डर पूर्ण झाल्यावरच",
    },
  },
};
const rs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function CouponSheet({
  baseAmount,
  durationMinutes,
  categoryId,
  appliedCode,
  onApplied,
  onClose,
}: {
  baseAmount: number;
  durationMinutes?: number | null;
  categoryId?: string | null;
  appliedCode: string | null;
  onApplied: (c: AppliedCoupon) => void;
  onClose: () => void;
}) {
  const { lang } = useLanguage();
  const s = T[lang === "mr" ? "mr" : "en"];
  useBackHandler(true, onClose);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["checkout_coupons", Math.round(baseAmount * 100), durationMinutes ?? null, categoryId ?? null],
    queryFn: () => fetchCheckoutCoupons(baseAmount, durationMinutes, categoryId),
    staleTime: 30_000,
  });

  const reasonText = (reason: string | null | undefined, min?: number | null) => {
    if (reason === "min_order") return s.r.min_order.replace("{n}", rs(Math.max(0, Math.ceil(Number(min ?? 0) - baseAmount))));
    return (reason && (s.r as Record<string, string>)[reason]) || s.r.other;
  };

  async function apply(c: string) {
    const v = c.trim().toUpperCase();
    if (!v || busy) return;
    setBusy(v);
    setErr(null);
    const res = await previewCoupon(v, baseAmount, durationMinutes, categoryId);
    setBusy(null);
    if (res.ok) onApplied(res.coupon);
    else setErr(reasonText(res.reason, res.min_order_amount));
  }

  const ok = data.filter((c) => c.ok);
  const bad = data.filter((c) => !c.ok);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-foreground/40" onClick={onClose}>
      <div
        className="mx-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-background px-5 pb-[calc(var(--app-safe-bottom,0px)+20px)] pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-lg font-extrabold text-foreground">{s.title}</p>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void apply(code); }}>
          <input
            value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }} placeholder={s.ph}
            className="min-w-0 flex-1 rounded-[12px] border border-border bg-card px-3 py-2.5 text-sm uppercase text-foreground outline-none focus:border-primary"
          />
          <button type="submit" disabled={!code.trim() || !!busy} className="rounded-[12px] bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground disabled:opacity-50">
            {busy === code.trim().toUpperCase() ? <Loader2 className="h-4 w-4 animate-spin" /> : s.apply}
          </button>
        </form>
        {err && <p className="mt-1.5 text-xs font-semibold text-destructive">{err}</p>}

        {isLoading ? (
          <div className="mt-4 space-y-2">{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-[14px] bg-muted" />)}</div>
        ) : data.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">{s.none}</p>
        ) : (
          <>
            {ok.length > 0 && <p className="mt-5 text-xs font-bold uppercase tracking-wide text-muted-foreground">{s.available}</p>}
            {ok.map((c) => <Card key={c.code} c={c} s={s} applied={appliedCode === c.code} busy={busy === c.code} onApply={() => void apply(c.code)} />)}
            {bad.length > 0 && <p className="mt-5 text-xs font-bold uppercase tracking-wide text-muted-foreground">{s.unavailable}</p>}
            {bad.map((c) => <Card key={c.code} c={c} s={s} reason={reasonText(c.reason, c.min_order_amount)} />)}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ c, s, applied, busy, reason, onApply }: {
  c: CheckoutCoupon; s: (typeof T)["en"]; applied?: boolean; busy?: boolean; reason?: string; onApply?: () => void;
}) {
  const desc = c.description?.trim() || c.title?.trim();
  return (
    <div className={`mt-2 rounded-[14px] border border-border bg-card p-3.5 ${reason ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 rounded-[8px] border border-dashed border-primary px-2 py-0.5 text-xs font-extrabold text-primary">
          <Tag className="h-3 w-3" />{c.code}
        </span>
        <span className="flex-1" />
        {applied ? (
          <span className="flex items-center gap-1 text-sm font-extrabold text-primary"><Check className="h-4 w-4" />{s.applied}</span>
        ) : onApply ? (
          <button onClick={onApply} disabled={busy} className="text-sm font-extrabold text-primary disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : s.apply}
          </button>
        ) : null}
      </div>
      {desc && <p className="mt-1.5 line-clamp-2 text-sm text-foreground">{desc}</p>}
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
        {c.min_order_amount ? <span className="text-muted-foreground">{s.min.replace("{n}", rs(Number(c.min_order_amount)))}</span> : null}
        {c.ok && c.discount ? <span className="font-extrabold text-primary">{s.save.replace("{n}", rs(Number(c.discount)))}</span> : null}
      </div>
      {reason && <p className="mt-1 text-xs font-semibold text-destructive">{reason}</p>}
    </div>
  );
}
