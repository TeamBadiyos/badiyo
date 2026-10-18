import { ensureSignedIn } from "@/lib/authGate";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOfferPayment,
  fetchLiveOffers,
  fetchMyRedemptions,
  fetchOfferRemaining,
  OfferApiError,
  redeemOffer,
  undoRedemption,
  verifyOfferPayment,
  type EventOffer,
  type MyRedemption,
} from "@/lib/deals";
import { payWithRazorpay } from "@/lib/razorpayCheckout";

export function useDeals() {
  const offers = useQuery({ queryKey: ["event_offers"], queryFn: fetchLiveOffers, staleTime: 0 });
  const mine = useQuery({ queryKey: ["event_redemptions_mine"], queryFn: fetchMyRedemptions, staleTime: 0 });
  return { offers, mine };
}

const ERR: Record<string, string> = {
  DEVICE_LIMIT_REACHED: "Ye offer is phone pe already use ho chuka hai",
  OUT_OF_STOCK: "Stock khatam ho gaya 😔",
  NOT_ACTIVE: "Offer khatam ho gaya",
  NOT_ELIGIBLE: "Ye offer aapke liye nahi hai",
  LIMIT_REACHED: "Already used ✓",
};

const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

export function DealsTab({ focusId }: { focusId?: string | null }) {
  const qc = useQueryClient();
  const { offers, mine } = useDeals();
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["event_offers"] });
    qc.invalidateQueries({ queryKey: ["event_redemptions_mine"] });
    qc.invalidateQueries({ queryKey: ["offer_remaining"] });
  }, [qc]);

  if (offers.isLoading || mine.isLoading) return <p className="mt-8 text-center text-sm text-muted-foreground">Loading…</p>;
  if (offers.isError || mine.isError)
    return (
      <div className="mt-8 text-center">
        <p className="text-sm text-muted-foreground">Internet check karein</p>
        <button className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" onClick={() => { offers.refetch(); mine.refetch(); }}>Retry</button>
      </div>
    );
  const list = offers.data ?? [];
  if (!list.length) return <p className="mt-8 text-center text-sm text-muted-foreground">Abhi koi deal live nahi hai. Stay tuned!</p>;
  return (
    <div className="mt-4 space-y-4">
      {list.map((o) => (
        <DealCard key={o.id} offer={o} mine={(mine.data ?? []).filter((r) => r.offer_id === o.id)} focus={focusId === o.id} />
      ))}
    </div>
  );
}

type Local = { kind: "error"; msg: string; retry?: boolean; refreshLabel?: boolean } | null;

function DealCard({ offer, mine, focus }: { offer: EventOffer; mine: MyRedemption[]; focus: boolean }) {
  const qc = useQueryClient();
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<Local>(null);
  const remaining = useQuery({ queryKey: ["offer_remaining", offer.id], queryFn: () => fetchOfferRemaining(offer.id), staleTime: 0 });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["event_redemptions_mine"] }),
      qc.invalidateQueries({ queryKey: ["offer_remaining", offer.id] }),
    ]);

  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const latest = mine.find((r) => !["undone", "failed", "cancelled", "expired"].includes(r.status));
  const deadline = latest?.undo_deadline ? new Date(latest.undo_deadline).getTime() : 0;
  const undoLeft = latest?.status === "pending" && deadline > now ? Math.ceil((deadline - now) / 1000) : 0;
  const isPaid = latest?.status === "paid";
  const used = latest && !isPaid && latest.status !== "payment_pending" && latest.status !== "created" && latest.status !== "refunded";
  const free = Number(offer.price) <= 0;

  const doRedeem = async (pin?: string): Promise<boolean> => {
    if (!(await ensureSignedIn())) return false;
    setBusy(true);
    try {
      const r = await redeemOffer(offer.id, pin);
      if (r.ok) { setLocal(null); setPinOpen(false); await refresh(); return true; }
      if (r.error === "WRONG_PIN") return false;
      setPinOpen(false);
      setLocal({ kind: "error", msg: ERR[r.error] ?? r.error });
      await refresh();
      return true;
    } catch {
      setPinOpen(false);
      setLocal({ kind: "error", msg: "Internet check karein", retry: true });
      return true;
    } finally { setBusy(false); }
  };

  const onSwiped = () => { offer.require_staff_pin ? setPinOpen(true) : void doRedeem(); };

  const onUndo = async () => {
    if (!latest) return;
    setBusy(true);
    try {
      const r = await undoRedemption(latest.id);
      if (!r.ok) setLocal({ kind: "error", msg: "Undo ka time khatam ho gaya" });
    } catch { setLocal({ kind: "error", msg: "Internet check karein", retry: true }); }
    finally { setBusy(false); await refresh(); }
  };

  const onPay = async () => {
    if (!(await ensureSignedIn())) return;
    setBusy(true); setLocal(null);
    try {
      let p;
      try {
        p = await createOfferPayment(offer.id);
      } catch (e: any) {
        if (e instanceof OfferApiError && e.kind === "code" && e.code) {
          setLocal({ kind: "error", msg: ERR[e.code] ?? "Ye offer abhi available nahi hai" });
        } else {
          setLocal({ kind: "error", msg: "Payment shuru nahi hua, dobara try karein", retry: true });
        }
        return;
      }
      if (p.alreadyPaid) return; // refresh shows Paid ✓ + slider
      let res;
      try {
        res = await payWithRazorpay({ key: p.keyId, order_id: p.razorpayOrderId, amount: p.amountPaise, currency: p.currency, name: "Badiyos", description: offer.title });
      } catch {
        setLocal({ kind: "error", msg: "Payment nahi hua, dobara try karein", retry: true });
        return;
      }
      try {
        await verifyOfferPayment(res);
      } catch {
        setLocal({ kind: "error", msg: "Payment verify nahi hua. Agar paise kat gaye hain to thodi der mein apne aap update ho jaayega", retry: true, refreshLabel: true });
      }
    } finally { setBusy(false); await refresh(); }
  };

  const success = latest && (latest.status === "pending" || latest.status === "confirmed") ;
  const finalUsed = success && undoLeft === 0;

  // ---------- render ----------
  if (success && undoLeft > 0) {
    return (
      <div ref={ref} className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-primary-light via-primary to-primary-dark p-6 text-center text-primary-foreground shadow-xl">
        <div className="deal-shimmer pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary-foreground text-5xl font-black text-primary shadow-lg">✓</div>
        <p className="relative mt-4 text-2xl font-black tracking-tight">{offer.success_title || "Redeemed!"}</p>
        {offer.success_message && <p className="relative mt-1 text-sm font-semibold opacity-90">{offer.success_message}</p>}
        <p className="relative mt-3 text-xs font-bold uppercase tracking-widest opacity-80">Redeemed at {fmtTime(latest!.redeemed_at)}</p>
        <button disabled={busy} onClick={onUndo} className="relative mt-4 rounded-full border-2 border-primary-foreground/70 px-5 py-2 text-sm font-extrabold">Undo ({undoLeft})</button>
      </div>
    );
  }

  const grey = (finalUsed || used) ? `Already used ✓ at ${fmtTime(latest?.redeemed_at)}` : local?.kind === "error" && !local.retry ? local.msg : null;
  const rules = (offer.rules_text ?? "").split(/\n+/).map((s) => s.replace(/^[\s•\-*\d.)]+/, "").trim()).filter(Boolean);
  const off = !free && offer.mrp && Number(offer.mrp) > Number(offer.price) ? Math.round((1 - Number(offer.price) / Number(offer.mrp)) * 100) : 0;

  return (
    <div ref={ref} className={`overflow-hidden rounded-[24px] border bg-card shadow-lg ${grey ? "border-border" : "border-primary/30"} ${focus ? "ring-2 ring-primary" : ""}`}>
      {/* Hero band */}
      <div className={`relative overflow-hidden px-5 pb-5 pt-4 ${grey ? "bg-muted" : "bg-gradient-to-br from-primary-light via-primary to-primary-dark text-primary-foreground"}`}>
        {!grey && <div className="deal-shimmer pointer-events-none absolute inset-0" />}
        <div className="relative flex items-center justify-between">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${grey ? "bg-background text-muted-foreground" : "bg-primary-foreground/20"}`}>badiyos deal</span>
        </div>
        <div className="relative mt-4 flex items-center gap-4">
          {offer.image_url ? (
            <img src={offer.image_url} alt="" className="h-20 w-20 shrink-0 rounded-[18px] object-cover shadow-md" />
          ) : (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[18px] bg-card text-5xl shadow-md">{offer.emoji || "🎁"}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-xl font-black leading-tight tracking-tight ${grey ? "text-foreground" : ""}`}>{offer.title}</p>
            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              {free ? (
                <span className={`rounded-[10px] px-3 py-0.5 text-lg font-black ${grey ? "bg-background text-primary" : "bg-primary-foreground text-primary"}`}>FREE</span>
              ) : (
                <>
                  <span className="text-2xl font-black">₹{offer.price}</span>
                  {offer.mrp ? <span className="text-sm font-semibold line-through opacity-70">₹{offer.mrp}</span> : null}
                  {off > 0 && <span className="rounded-full bg-primary-foreground px-2 py-0.5 text-[11px] font-black text-primary">{off}% OFF</span>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-5">
        {offer.description && <p className="text-[15px] leading-relaxed text-foreground">{offer.description}</p>}
        {typeof remaining.data === "number" && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-extrabold text-destructive">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" /> Sirf {remaining.data} bache — jaldi karein!
          </p>
        )}

        {rules.length > 0 && (
          <div className="mt-4 rounded-[16px] border border-primary/20 bg-primary/5 p-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-primary">Rules</p>
            <ul className="mt-2 space-y-2">
              {rules.map((r, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">{i + 1}</span>
                  <span className="leading-snug">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          {grey ? (
            <div className="rounded-[16px] border-2 border-dashed border-primary/40 bg-primary/5 py-3.5 text-center">
              <p className="text-sm font-black text-primary">{grey}</p>
            </div>
          ) : !free && !isPaid ? (
            <button disabled={busy} onClick={onPay} className="w-full rounded-full bg-primary py-4 text-base font-black text-primary-foreground shadow-lg disabled:opacity-60">
              {busy ? "…" : `Pay ₹${offer.price}`}
            </button>
          ) : (
            <>
              {isPaid && <p className="mb-2 text-center text-sm font-bold text-primary">Paid ✓ — counter pe swipe karwao</p>}
              <SwipeSlider label={offer.button_text || "Swipe to redeem"} disabled={busy} onDone={onSwiped} />
            </>
          )}
          {local?.retry && (
            <div className="mt-2 flex items-center justify-between rounded-[12px] bg-destructive/10 px-3 py-2">
              <span className="text-xs font-bold text-destructive">{local.msg}</span>
              <button className="text-xs font-bold text-primary" onClick={() => { setLocal(null); refresh(); qc.invalidateQueries({ queryKey: ["event_offers"] }); }}>{local.refreshLabel ? "Refresh" : "Retry"}</button>
            </div>
          )}
          {!grey && <p className="mt-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">🔒 Swipe sirf counter pe karwayein</p>}
        </div>
      </div>
      {pinOpen && <PinPad busy={busy} onClose={() => setPinOpen(false)} onSubmit={doRedeem} />}
    </div>
  );
}

export function LiveClock({ now, light }: { now: number; light?: boolean }) {
  const t = new Date(now).toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Kolkata" });
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-bold tabular-nums ${light ? "bg-primary-foreground/20" : "bg-background text-foreground"}`}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> LIVE {t}
    </span>
  );
}

export function SwipeSlider({ label, disabled, onDone }: { label: string; disabled?: boolean; onDone: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const start = useRef<number | null>(null);
  const KNOB = 48;
  const max = () => (track.current?.clientWidth ?? 300) - KNOB - 8;
  const down = (e: React.PointerEvent) => { if (disabled) return; start.current = e.clientX - x; (e.target as Element).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { if (start.current == null) return; setX(Math.max(0, Math.min(max(), e.clientX - start.current))); };
  const up = () => {
    if (start.current == null) return;
    start.current = null;
    if (x >= max() * 0.9) onDone();
    setX(0);
  };
  return (
    <div ref={track} className="relative h-14 select-none overflow-hidden rounded-full bg-primary/15 touch-none">
      <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold text-primary">{label} →</span>
      <div
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{ transform: `translateX(${x}px)`, transition: start.current == null ? "transform .2s" : "none" }}
        className="absolute left-1 top-1 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl text-primary-foreground shadow"
      >»</div>
    </div>
  );
}

function PinPad({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (pin.length !== 4) return;
    void onSubmit(pin).then((ok) => { if (!ok) { setBad(true); setPin(""); setTimeout(() => setBad(false), 600); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-foreground/50" onClick={onClose}>
      <div className={`w-full max-w-md rounded-t-[24px] bg-card p-5 ${bad ? "deal-shake" : ""}`} onClick={(e) => e.stopPropagation()}>
        <p className="text-center font-extrabold text-foreground">Staff PIN</p>
        <div className="my-3 flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-primary" : "bg-muted"}`} />)}
        </div>
        {bad && <p className="text-center text-sm font-bold text-destructive">Galat PIN</p>}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => (
            <button key={i} disabled={busy || !k} onClick={() => setPin((p) => k === "⌫" ? p.slice(0, -1) : p.length < 4 ? p + k : p)}
              className="h-14 rounded-[14px] bg-muted text-xl font-bold text-foreground disabled:opacity-0">{k}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DealsHomeBanner({ onOpen }: { onOpen: (id: string) => void }) {
  const { offers } = useDeals();
  const o = (offers.data ?? []).find((x) => x.show_as_home_banner);
  if (!o) return null;
  return (
    <button onClick={() => onOpen(o.id)} className="relative mt-3 flex w-full items-center gap-3 overflow-hidden rounded-[16px] border border-primary/40 bg-card p-3 text-left">
      <div className="deal-shimmer pointer-events-none absolute inset-0" />
      <span className="relative text-3xl">{o.emoji || "🎁"}</span>
      <span className="relative min-w-0 flex-1">
        <span className="block font-extrabold text-foreground">{o.title}</span>
        <span className="block text-xs font-bold text-primary">{Number(o.price) <= 0 ? "FREE" : `₹${o.price}`} · Deal dekhein →</span>
      </span>
    </button>
  );
}
