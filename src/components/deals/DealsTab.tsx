import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOfferPayment,
  fetchLiveOffers,
  fetchMyRedemptions,
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

function useNow(ms = 1000) {
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
  const [rulesOpen, setRulesOpen] = useState(false);
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
      <div ref={ref} className="rounded-[20px] bg-primary p-5 text-center text-primary-foreground shadow-lg">
        <div className="text-6xl">✓</div>
        <p className="mt-2 text-lg font-extrabold">{offer.success_title || "Redeemed!"}</p>
        {offer.success_message && <p className="mt-1 text-sm opacity-90">{offer.success_message}</p>}
        <p className="mt-2 text-xs opacity-80">{fmtTime(latest!.redeemed_at)}</p>
        <LiveClock now={now} light />
        <button disabled={busy} onClick={onUndo} className="mt-3 rounded-full border border-primary-foreground/60 px-4 py-1.5 text-sm font-bold">Undo ({undoLeft})</button>
      </div>
    );
  }

  const grey = (finalUsed || used) ? `Already used ✓ at ${fmtTime(latest?.redeemed_at)}` : local?.kind === "error" && !local.retry ? local.msg : null;

  return (
    <div ref={ref} className={`relative overflow-hidden rounded-[20px] border p-4 ${grey ? "border-border bg-muted" : "border-primary/40 bg-card"} ${focus ? "ring-2 ring-primary" : ""}`}>
      {!grey && <div className="deal-shimmer pointer-events-none absolute inset-0" />}
      <div className="relative flex gap-3">
        {offer.image_url ? <img src={offer.image_url} alt="" className="h-16 w-16 rounded-[12px] object-cover" /> : <div className="text-4xl">{offer.emoji || "🎁"}</div>}
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-foreground">{offer.title}</p>
          {offer.description && <p className="text-sm text-muted-foreground">{offer.description}</p>}
          <p className="mt-1 text-base font-extrabold text-primary">
            {free ? "FREE" : (<>{offer.mrp ? <span className="mr-1 text-sm text-muted-foreground line-through">₹{offer.mrp}</span> : null}₹{offer.price}</>)}
          </p>
        </div>
      </div>
      {offer.rules_text && (
        <button className="relative mt-2 text-xs font-bold text-primary" onClick={() => setRulesOpen((v) => !v)}>{rulesOpen ? "Rules ▲" : "Rules ▼"}</button>
      )}
      {rulesOpen && <p className="relative mt-1 whitespace-pre-line text-xs text-muted-foreground">{offer.rules_text}</p>}
      <div className="relative"><LiveClock now={now} /></div>

      <div className="relative mt-3">
        {grey ? (
          <p className="rounded-full bg-background py-3 text-center text-sm font-bold text-muted-foreground">{grey}</p>
        ) : !free && !isPaid ? (
          <button disabled={busy} onClick={onPay} className="w-full rounded-full bg-primary py-3 text-sm font-extrabold text-primary-foreground disabled:opacity-60">
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
            <button className="text-xs font-bold text-primary" onClick={() => { setLocal(null); refresh(); qc.invalidateQueries({ queryKey: ["event_offers"] }); }}>Retry</button>
          </div>
        )}
        {!grey && <p className="mt-2 text-center text-[11px] text-muted-foreground">Swipe sirf counter pe karwayein</p>}
      </div>
      {pinOpen && <PinPad busy={busy} onClose={() => setPinOpen(false)} onSubmit={doRedeem} />}
    </div>
  );
}

function LiveClock({ now, light }: { now: number; light?: boolean }) {
  const t = new Date(now).toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Kolkata" });
  return <p className={`mt-2 text-center font-mono text-sm font-bold tabular-nums ${light ? "" : "text-foreground"}`}>🔴 LIVE {t}</p>;
}

function SwipeSlider({ label, disabled, onDone }: { label: string; disabled?: boolean; onDone: () => void }) {
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
