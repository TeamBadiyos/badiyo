import { useState } from "react";
import { ArrowLeft, ChevronRight, Droplets, MapPin, Package, Tag, Wallet, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { CancellationPolicySheet } from "@/components/CancellationPolicySheet";
import { CouponSheet } from "@/components/CouponSheet";
import { ensureSignedIn } from "@/lib/authGate";
import type { SelectedService, SelectedSlot } from "@/lib/bookingTypes";
import { useLanguage } from "@/i18n";
import { hapticImpact } from "@/lib/haptics";
import { billBreakdown } from "@/lib/gst";
import { useBookingGstPercent, useServiceContent } from "@/lib/serviceSettings";
import type { AppliedCoupon } from "@/lib/coupons";
import { fetchMyCoinBalance } from "@/lib/coins";

export type SelectedAddress = {
  id: string;
  label: string | null;
  full_address: string;
  area: string | null;
  city: string | null;
  is_default: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
};

const TXT = {
  en: {
    title: "Checkout", change: "Change", booking: "What you're booking", edit: "Edit", now: "Now",
    save: "You save ₹{n} on this booking", applyCoupon: "Apply coupon", remove: "Remove",
    wallet: "Use badiyos Wallet", noteLabel: "Note for expert (optional)", notePh: "E.g. ring the bell twice, pet at home…",
    bill: "Bill details", price: "Service price", gst: "GST ({p}%)", round: "Round off", coupon: "Coupon",
    walletLine: "badiyos Wallet", total: "Total", policy: "Cancellation policy", pay: "Pay ₹{n}", payWallet: "Pay with wallet",
    maidNote: "Our expert brings basic supplies. Please keep a broom, mop and bucket ready if you prefer your own.",
    washNote: "Please keep a water supply and a plug point ready, and the vehicle parked. Our expert will not drive the vehicle.",
    home: "Home Maid", wash: "Car Wash",
  },
  mr: {
    title: "चेकआउट", change: "बदला", booking: "तुम्ही काय बुक करत आहात", edit: "बदला", now: "आत्ता",
    save: "या बुकिंगवर तुमची ₹{n} बचत", applyCoupon: "कूपन लावा", remove: "काढा",
    wallet: "badiyos वॉलेट वापरा", noteLabel: "एक्सपर्टसाठी सूचना (ऐच्छिक)", notePh: "उदा. बेल दोनदा वाजवा, घरी पाळीव प्राणी आहे…",
    bill: "बिल तपशील", price: "सेवा किंमत", gst: "GST ({p}%)", round: "राउंड ऑफ", coupon: "कूपन",
    walletLine: "badiyos वॉलेट", total: "एकूण", policy: "रद्द करण्याचे धोरण", pay: "₹{n} भरा", payWallet: "वॉलेटने भरा",
    maidNote: "आमचा एक्सपर्ट मूलभूत साहित्य आणतो. स्वतःचे हवे असल्यास झाडू, पोछा व बादली तयार ठेवा.",
    washNote: "कृपया पाणी व प्लग पॉइंट तयार ठेवा आणि वाहन पार्क केलेले असावे. आमचा एक्सपर्ट वाहन चालवणार नाही.",
    home: "होम मेड", wash: "कार वॉश",
  },
};
const fill = (s: string, k: string, v: string | number) => s.replace(`{${k}}`, String(v));
const rs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function whenLabel(slot: SelectedSlot, lang: "en" | "mr", now: string) {
  if (slot.mode === "now") return now;
  const d = new Date(slot.day).toLocaleDateString(lang === "mr" ? "mr-IN" : "en-IN", { weekday: "short", day: "numeric", month: "short" });
  return `${d} · ${slot.slotLabel}`;
}

/** Shared checkout. Clean uses it today; Store/Food/Parcel will reuse the same layout. */
export function BookingSummaryScreen({
  service, slot, address, coupon, onCouponChange, onOpenCoupons,
  redeemCoins = false, onRedeemCoinsChange, onBack, onEditAddress, onProceedToPay,
  note = "", onNoteChange,
}: {
  service: SelectedService;
  slot: SelectedSlot;
  address: SelectedAddress;
  coupon: AppliedCoupon | null;
  onCouponChange: (coupon: AppliedCoupon | null) => void;
  onOpenCoupons?: () => void;
  redeemCoins?: boolean;
  onRedeemCoinsChange?: (on: boolean) => void;
  onBack: () => void;
  onEditAddress: () => void;
  onProceedToPay: () => void;
  note?: string;
  onNoteChange?: (v: string) => void;
}) {
  const { lang } = useLanguage();
  const L = lang === "mr" ? "mr" : "en";
  const s = TXT[L];
  const isWash = slot.serviceKey === "wash";
  const { data: content } = useServiceContent(isWash ? "wash" : "clean");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);

  const gstPercent = useBookingGstPercent(service.id);
  const price = Number(service.price);
  const bill = billBreakdown(price, gstPercent, coupon?.discount ?? 0);
  const { data: balance = 0 } = useQuery({ queryKey: ["my_coin_balance"], queryFn: fetchMyCoinBalance, staleTime: 30_000 });
  const walletUsed = redeemCoins ? Math.max(0, Math.min(balance, bill.total)) : 0;
  const total = Math.max(0, bill.total - walletUsed);
  const original = Number(service.strikethrough_price ?? 0);
  const saving = Math.max(0, Math.round(original - price)) + Math.round(coupon?.discount ?? 0);

  const name = isWash ? s.wash : s.home;
  const lineTitle = isWash ? `${name} · ${service.duration_label}` : `${name} · ${service.duration_label}`;
  const ccNote = (L === "mr" && content?.details?.note_mr?.trim()) || content?.details?.note?.trim() || (isWash ? s.washNote : s.maidNote);
  const NoteIcon = isWash || content?.details?.note_icon === "water" ? Droplets : Package;

  const row = (label: string, value: string, accent = false) => (
    <div className="mt-2 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={accent ? "font-bold text-primary" : "text-foreground"}>{value}</span>
    </div>
  );

  return (
    <main className="min-h-screen w-full bg-surface-soft pb-32">
      <div className="mx-auto w-full max-w-md px-4 pt-5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-soft">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-extrabold text-foreground">{s.title}</h1>
        </div>

        {/* 1. Address */}
        <section className="mt-4 flex items-center gap-3 rounded-[16px] bg-card px-4 py-3 shadow-soft">
          <MapPin className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-foreground">{address.label || address.area || "—"}</p>
            <p className="truncate text-xs text-muted-foreground">{address.full_address}</p>
          </div>
          <button type="button" onClick={onEditAddress} className="shrink-0 text-sm font-extrabold text-primary">{s.change}</button>
        </section>

        {/* 2. What you're booking */}
        <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{s.booking}</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[12px] bg-muted">
              {service.image_url && <img src={service.image_url} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-extrabold text-foreground">{lineTitle}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{whenLabel(slot, L, s.now)}</p>
              <p className="mt-0.5 text-sm font-extrabold text-foreground">
                ₹{rs(price)}
                {original > price && <span className="ml-1.5 text-xs font-semibold text-muted-foreground line-through">₹{rs(original)}</span>}
              </p>
            </div>
            <button type="button" onClick={onBack} className="shrink-0 self-start text-sm font-extrabold text-primary">{s.edit}</button>
          </div>
        </section>

        {/* 3. Savings */}
        {saving > 0 && (
          <div className="mt-3 rounded-[14px] bg-primary/10 px-4 py-2.5 text-center text-sm font-extrabold text-primary">
            🎉 {fill(s.save, "n", saving)}
          </div>
        )}

        {/* 4. Coupon + wallet */}
        <section className="mt-3 overflow-hidden rounded-[16px] bg-card shadow-soft">
          {coupon ? (
            <div className="flex items-center gap-3 px-4 py-3.5">
              <Tag className="h-5 w-5 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-foreground">{coupon.code} · −₹{rs(coupon.discount)}</p>
              <button type="button" onClick={() => onCouponChange(null)} className="flex items-center gap-1 text-sm font-extrabold text-destructive">
                <X className="h-4 w-4" />{s.remove}
              </button>
            </div>
          ) : (
            <button type="button" onClick={async () => { if (await ensureSignedIn()) setCouponOpen(true); }} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Tag className="h-5 w-5 shrink-0 text-primary" />
              <span className="flex-1 text-sm font-extrabold text-foreground">{s.applyCoupon}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
          {balance > 0 && (
            <>
              <div className="mx-4 border-t border-border" />
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Wallet className="h-5 w-5 shrink-0 text-primary" />
                <span className="flex-1 text-sm font-extrabold text-foreground">{s.wallet} (₹{balance})</span>
                <Switch checked={redeemCoins} aria-label={s.wallet}
                  onCheckedChange={(v) => { void hapticImpact("light"); onRedeemCoinsChange?.(v); }} />
              </div>
            </>
          )}
        </section>

        {/* 5. Note */}
        <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
          <label htmlFor="expert-note" className="text-sm font-extrabold text-foreground">{s.noteLabel}</label>
          <textarea id="expert-note" value={note} maxLength={300} rows={2} placeholder={s.notePh}
            onChange={(e) => onNoteChange?.(e.target.value.slice(0, 300))}
            className="mt-2 w-full resize-none rounded-[12px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
          <p className="text-right text-[11px] text-muted-foreground">{note.length}/300</p>
          <div className="mt-2 flex items-start gap-2.5 rounded-[12px] bg-surface-soft p-3">
            <NoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs font-semibold text-foreground">{ccNote}</p>
          </div>
        </section>

        {/* 6. Bill */}
        <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
          <p className="text-sm font-extrabold text-foreground">{s.bill}</p>
          {row(s.price, `₹${rs(price)}`)}
          {bill.discount > 0 && row(s.coupon, `−₹${rs(Math.round(bill.discount))}`, true)}
          {row(fill(s.gst, "p", gstPercent), `₹${rs(bill.gst)}`)}
          {bill.roundOff !== 0 && row(s.round, `${bill.roundOff > 0 ? "+" : "−"}₹${Math.abs(bill.roundOff).toFixed(2)}`)}
          {walletUsed > 0 && row(s.walletLine, `−₹${rs(walletUsed)}`, true)}
          <div className="my-3 h-px bg-border" />
          <div className="flex items-center justify-between text-base font-extrabold text-foreground">
            <span>{s.total}</span><span>₹{rs(total)}</span>
          </div>
          <button type="button" onClick={() => setPolicyOpen(true)} className="mt-3 flex items-center gap-1 text-sm font-bold text-primary">
            {s.policy}<ChevronRight className="h-4 w-4" />
          </button>
        </section>
      </div>

      {/* 7. Pay bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.06)] safe-bottom">
        <div className="mx-auto flex w-full max-w-md items-center gap-4 px-4 py-3">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{s.total}</span>
            <span className="text-lg font-extrabold text-foreground">₹{rs(total)}</span>
          </div>
          <button type="button" onClick={() => { void hapticImpact("medium"); onProceedToPay(); }}
            className="flex-1 rounded-[14px] bg-primary py-3.5 text-base font-extrabold text-primary-foreground active:scale-[0.99]">
            {total === 0 && walletUsed > 0 ? s.payWallet : fill(s.pay, "n", rs(total))}
          </button>
        </div>
      </div>

      {couponOpen && (
        <CouponSheet
          baseAmount={price}
          durationMinutes={service.duration_minutes}
          categoryId={service.service_category_id}
          appliedCode={coupon?.code ?? null}
          onApplied={(c) => { onCouponChange(c); setCouponOpen(false); }}
          onClose={() => setCouponOpen(false)}
        />
      )}
      <CancellationPolicySheet open={policyOpen} onClose={() => setPolicyOpen(false)} serviceKey={isWash ? "wash" : "clean"} />
    </main>
  );
}

export { BookingSummaryScreen as CheckoutScreen };
