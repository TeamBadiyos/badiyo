/**
 * Shared-Checkout layout for Store and Food orders (same look as the Clean
 * checkout): address, items, savings, coupon + wallet, note, bill, Pay.
 * Every amount comes from store_checkout_quote; store_place_order charges it.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Loader2, MapPin, Minus, Plus, Tag, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { ensureSignedIn } from "@/lib/authGate";
import { useBackHandler } from "@/lib/backHandler";
import { hapticImpact } from "@/lib/haptics";
import { useStoreCart } from "@/lib/storeCart";
import { invalidateWallet } from "@/lib/wallet";
import { StoreImage } from "@/components/store/StoreImage";
import { AddressSelectionScreen } from "@/components/AddressSelectionScreen";
import { CouponSheet } from "@/components/CouponSheet";
import { CancellationPolicySheet } from "@/components/CancellationPolicySheet";
import {
  attachStorePayment,
  confirmStorePayment,
  fetchStoreCheckoutQuote,
  placeStoreOrder,
  StoreOrderError,
} from "@/lib/storeOrders";
import { getPaymentPrefill } from "@/lib/paymentPrefill";
import { payWithRazorpay, PaymentCancelledError } from "@/lib/razorpayCheckout";

type Address = { id: string; label: string | null; full_address: string | null; area: string | null; city: string | null };

const TXT = {
  en: {
    title: "Checkout", change: "Change", addAddress: "Add delivery address", items: "Your items", addMore: "+ Add more items",
    save: "You save ₹{n} on this order", applyCoupon: "Apply coupon", couponPh: "Enter coupon code", apply: "Apply", remove: "Remove",
    wallet: "Use badiyos Wallet", noteRider: "Note for rider (optional)", noteRest: "Note for restaurant (optional)",
    notePhRider: "E.g. call on arrival, leave at gate…", notePhRest: "E.g. less spicy, no onion…",
    bill: "Bill details", itemTotal: "Item total", delivery: "Delivery fee", gstItems: "GST on items", gstDelivery: "GST on delivery",
    platform: "Platform fee", gstPlatform: "GST on platform fee", coupon: "Coupon", walletLine: "badiyos Wallet", total: "To pay",
    pay: "Pay ₹{n}", payWallet: "Pay with wallet", empty: "Your cart is empty", placed: "Order placed",
    couponBad: "This coupon can't be used on this order", couponMin: "Minimum order of ₹{n} required for this coupon",
    errGeneric: "Couldn't place the order. Please try again.", errClosed: "This shop is closed right now",
    errStock: "Some items are out of stock", errDelivery: "Delivery isn't available to this address", errMin: "Order is below the minimum amount",
  },
  mr: {
    title: "चेकआउट", change: "बदला", addAddress: "डिलिव्हरी पत्ता जोडा", items: "तुमच्या वस्तू", addMore: "+ आणखी वस्तू जोडा",
    save: "या ऑर्डरवर तुमची ₹{n} बचत", applyCoupon: "कूपन लावा", couponPh: "कूपन कोड टाका", apply: "लावा", remove: "काढा",
    wallet: "badiyos वॉलेट वापरा", noteRider: "रायडरसाठी सूचना (ऐच्छिक)", noteRest: "रेस्टॉरंटसाठी सूचना (ऐच्छिक)",
    notePhRider: "उदा. पोहोचल्यावर कॉल करा, गेटवर ठेवा…", notePhRest: "उदा. कमी तिखट, कांदा नको…",
    bill: "बिल तपशील", itemTotal: "वस्तूंची एकूण किंमत", delivery: "डिलिव्हरी शुल्क", gstItems: "वस्तूंवरील GST", gstDelivery: "डिलिव्हरीवरील GST",
    platform: "प्लॅटफॉर्म शुल्क", gstPlatform: "प्लॅटफॉर्म शुल्कावरील GST", coupon: "कूपन", walletLine: "badiyos वॉलेट", total: "भरायचे",
    pay: "₹{n} भरा", payWallet: "वॉलेटने भरा", empty: "तुमची कार्ट रिकामी आहे", placed: "ऑर्डर दिली",
    couponBad: "हे कूपन या ऑर्डरवर वापरता येत नाही", couponMin: "या कूपनसाठी किमान ₹{n} ची ऑर्डर हवी",
    errGeneric: "ऑर्डर देता आली नाही. पुन्हा प्रयत्न करा.", errClosed: "हे दुकान सध्या बंद आहे",
    errStock: "काही वस्तू संपल्या आहेत", errDelivery: "या पत्त्यावर डिलिव्हरी उपलब्ध नाही", errMin: "ऑर्डर किमान रकमेपेक्षा कमी आहे",
  },
};
const fill = (s: string, k: string, v: string | number) => s.replace(`{${k}}`, String(v));
const rs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

async function fetchAddresses(): Promise<Address[]> {
  const { data: u } = await getAuthUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, full_address, area, city")
    .eq("user_id", uid)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Address[];
}

export function CommerceCheckoutScreen({
  onBack,
  onDone,
  onAddMore,
}: {
  onBack: () => void;
  onDone: (orderId?: string) => void;
  onAddMore?: () => void;
  onAddAddress?: () => void;
}) {
  const { lang } = useLanguage();
  const s = TXT[lang === "mr" ? "mr" : "en"];
  const cart = useStoreCart();
  const qc = useQueryClient();
  const isFood = cart.cart.service === "food";
  const [addressId, setAddressId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [useWallet, setUseWallet] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  useBackHandler(true, () => (pickerOpen ? setPickerOpen(false) : onBack()));

  const { data: addresses = [] } = useQuery({ queryKey: ["my-addresses"], queryFn: fetchAddresses, staleTime: 60_000 });
  useEffect(() => {
    if (!addressId && addresses.length > 0) setAddressId(addresses[0].id);
  }, [addresses, addressId]);
  const address = useMemo(() => addresses.find((a) => a.id === addressId) ?? null, [addresses, addressId]);

  const merchantId = cart.cart.merchantId;
  const lines = cart.cart.lines;
  const sig = lines.map((l) => `${l.key}:${l.quantity}`).join("|");
  const { data: quote, isFetching } = useQuery({
    queryKey: ["store_checkout_quote", merchantId, addressId, sig, coupon, useWallet],
    enabled: Boolean(merchantId && addressId && lines.length > 0),
    queryFn: () => fetchStoreCheckoutQuote({ merchantId: merchantId!, lines, addressId: addressId!, couponCode: coupon, useWallet }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const q = quote && quote.ok ? quote : null;
  const quoteErr = quote && !quote.ok ? quote.code : null;

  // A coupon the backend rejects is removed with a message.
  useEffect(() => {
    if (!q || !coupon || !q.coupon || q.coupon.ok) return;
    toast.error(q.coupon.reason === "min_order" ? fill(s.couponMin, "n", q.coupon.min_order_amount ?? 0) : s.couponBad);
    setCoupon(null);
  }, [q, coupon, s]);

  const errText = (code: string) =>
    code === "store_closed" || code === "store_unavailable" ? s.errClosed
    : code === "out_of_stock" || code === "product_unavailable" ? s.errStock
    : code === "delivery_unavailable" || code === "delivery_too_far" || code === "bad_address" ? s.errDelivery
    : code === "below_min_order" ? s.errMin
    : code === "coupon_invalid" ? s.couponBad
    : s.errGeneric;

  async function pay() {
    if (placing || !merchantId || lines.length === 0) return;
    if (!(await ensureSignedIn())) return;
    if (!addressId) return setPickerOpen(true);
    setPlacing(true);
    void hapticImpact("medium");
    try {
      const created = await placeStoreOrder({ merchantId, lines, addressId, note: note.trim() || null, couponCode: coupon, useWallet });
      if (!created.paid) {
        const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
          body: { purpose: "store_order", store_order_id: created.order_id, currency: "INR", receipt: created.order_number },
        });
        if (error || !data?.order_id || !data?.key_id) throw new Error(error?.message ?? "payment_init_failed");
        await attachStorePayment(created.order_id, data.order_id as string);
        const prefill = await getPaymentPrefill();
        const resp = await payWithRazorpay({
          key: data.key_id, order_id: data.order_id, amount: data.amount, currency: data.currency,
          description: cart.cart.storeName ?? "badiyos", contact: prefill.contact, email: prefill.email, customerName: prefill.name,
        });
        await confirmStorePayment(created.order_id, resp.razorpay_order_id, resp.razorpay_payment_id);
      }
      cart.clear();
      invalidateWallet(qc);
      void qc.invalidateQueries({ queryKey: ["my-store-orders"] });
      toast.success(s.placed, { description: `#${created.order_number}` });
      onDone(created.order_id);
    } catch (err) {
      invalidateWallet(qc);
      if (err instanceof PaymentCancelledError) {
        void qc.invalidateQueries({ queryKey: ["my-store-orders"] });
        onDone();
        return;
      }
      if (err instanceof StoreOrderError) {
        if (err.code === "coupon_invalid") setCoupon(null);
        toast.error(errText(err.code));
      } else {
        console.error("[checkout] shop order failed", err);
        toast.error(s.errGeneric);
      }
    } finally {
      setPlacing(false);
    }
  }

  const row = (label: string, value: string, accent = false) => (
    <div className="mt-2 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={accent ? "font-bold text-primary" : "text-foreground"}>{value}</span>
    </div>
  );

  const total = q ? q.to_pay : cart.total;
  const saving = q ? Math.round(q.you_save + q.coupon_discount) : 0;
  const walletOnly = q != null && q.to_pay <= 0 && q.wallet_used > 0;

  const couponSheet = couponOpen ? (
    <CouponSheet
      baseAmount={q?.item_total ?? cart.total}
      appliedCode={coupon}
      onApplied={(c) => { setCoupon(c.code); setCouponOpen(false); }}
      onClose={() => setCouponOpen(false)}
    />
  ) : null;

  if (pickerOpen) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <AddressSelectionScreen
          onBack={() => setPickerOpen(false)}
          onContinue={(a) => {
            setAddressId(a.id);
            setPickerOpen(false);
            void qc.invalidateQueries({ queryKey: ["my-addresses"] });
          }}
        />
      </div>
    );
  }

  return (
    <main className="min-h-screen w-full bg-surface-soft pb-32">
      <div className="mx-auto w-full max-w-md px-4 pt-[calc(var(--app-safe-top,0px)+20px)]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-card shadow-soft">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-extrabold text-foreground">{s.title}</h1>
        </div>

        {lines.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">{s.empty}</p>
        ) : (
          <>
            {/* Address */}
            <section className="mt-4 flex items-center gap-3 rounded-[16px] bg-card px-4 py-3 shadow-soft">
              <MapPin className="h-5 w-5 shrink-0 text-primary" />
              {address ? (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-foreground">{address.label || address.area || "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">{address.full_address}</p>
                  </div>
                  <button type="button" onClick={() => setPickerOpen(true)} className="shrink-0 text-sm font-extrabold text-primary">{s.change}</button>
                </>
              ) : (
                <button type="button" onClick={async () => { if (await ensureSignedIn()) setPickerOpen(true); }} className="flex-1 text-left text-sm font-extrabold text-primary">
                  {s.addAddress}
                </button>
              )}
            </section>

            {/* Items */}
            <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {s.items}{cart.cart.storeName ? ` · ${cart.cart.storeName}` : ""}
              </p>
              <div className="mt-2 divide-y divide-border">
                {lines.map((l) => {
                  const extra = [l.variant_name, ...(l.addons ?? []).map((a) => a.name)].filter(Boolean).join(", ");
                  return (
                    <div key={l.key} className="flex items-center gap-3 py-2.5">
                      <StoreImage path={l.photo_url} alt={l.name} className="h-12 w-12 shrink-0 rounded-[10px]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-foreground">{l.name}</p>
                        {(extra || l.unit) && <p className="truncate text-xs text-muted-foreground">{extra || l.unit}</p>}
                        <p className="text-sm font-extrabold text-foreground">₹{rs(Number(l.price) * l.quantity)}</p>
                      </div>
                      <div className="flex items-center gap-2 rounded-[10px] border border-primary px-1.5 py-1 text-primary">
                        <button type="button" aria-label="-" onClick={() => cart.setQuantity(l.key, l.quantity - 1)} className="flex h-6 w-6 items-center justify-center">
                          <Minus className="h-3.5 w-3.5" strokeWidth={3} />
                        </button>
                        <span className="min-w-4 text-center text-sm font-extrabold tabular-nums">{l.quantity}</span>
                        <button type="button" aria-label="+" onClick={() => cart.setQuantity(l.key, l.quantity + 1)} className="flex h-6 w-6 items-center justify-center">
                          <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {onAddMore && (
                <button type="button" onClick={onAddMore} className="mt-2 text-sm font-extrabold text-primary">{s.addMore}</button>
              )}
            </section>

            {saving > 0 && (
              <div className="mt-3 rounded-[14px] bg-primary/10 px-4 py-2.5 text-center text-sm font-extrabold text-primary">
                🎉 {fill(s.save, "n", saving)}
              </div>
            )}

            {/* Coupon + wallet */}
            <section className="mt-3 overflow-hidden rounded-[16px] bg-card shadow-soft">
              {coupon && q?.coupon?.ok ? (
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Tag className="h-5 w-5 shrink-0 text-primary" />
                  <p className="min-w-0 flex-1 truncate text-sm font-extrabold text-foreground">{coupon} · −₹{rs(q.coupon_discount)}</p>
                  <button type="button" onClick={() => setCoupon(null)} className="flex items-center gap-1 text-sm font-extrabold text-destructive">
                    <X className="h-4 w-4" />{s.remove}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={async () => { if (await ensureSignedIn()) setCouponOpen(true); }}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                >
                  <Tag className="h-5 w-5 shrink-0 text-primary" />
                  <span className="flex-1 text-sm font-extrabold text-foreground">{s.applyCoupon}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              {q && q.wallet_balance > 0 && (
                <>
                  <div className="mx-4 border-t border-border" />
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <Wallet className="h-5 w-5 shrink-0 text-primary" />
                    <span className="flex-1 text-sm font-extrabold text-foreground">{s.wallet} (₹{rs(q.wallet_balance)})</span>
                    <Switch checked={useWallet} aria-label={s.wallet} onCheckedChange={(v) => { void hapticImpact("light"); setUseWallet(v); }} />
                  </div>
                </>
              )}
            </section>

            {/* Note */}
            <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
              <label htmlFor="order-note" className="text-sm font-extrabold text-foreground">{isFood ? s.noteRest : s.noteRider}</label>
              <textarea
                id="order-note" value={note} maxLength={300} rows={2} placeholder={isFood ? s.notePhRest : s.notePhRider}
                onChange={(e) => setNote(e.target.value.slice(0, 300))}
                className="mt-2 w-full resize-none rounded-[12px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <p className="text-right text-[11px] text-muted-foreground">{note.length}/300</p>
            </section>

            {/* Bill */}
            <section className="mt-3 rounded-[16px] bg-card p-4 shadow-soft">
              <p className="text-sm font-extrabold text-foreground">{s.bill}</p>
              {q ? (
                <>
                  {row(s.itemTotal, `₹${rs(q.item_total)}`)}
                  {row(s.delivery, `₹${rs(q.delivery_fee)}`)}
                  {q.gst_items > 0 && row(s.gstItems, `₹${rs(q.gst_items)}`)}
                  {q.gst_delivery > 0 && row(s.gstDelivery, `₹${rs(q.gst_delivery)}`)}
                  {q.platform_fee > 0 && row(s.platform, `₹${rs(q.platform_fee)}`)}
                  {q.gst_platform > 0 && row(s.gstPlatform, `₹${rs(q.gst_platform)}`)}
                  {q.coupon_discount > 0 && row(s.coupon, `−₹${rs(q.coupon_discount)}`, true)}
                  {q.wallet_used > 0 && row(s.walletLine, `−₹${rs(q.wallet_used)}`, true)}
                  <div className="my-3 h-px bg-border" />
                  <div className="flex items-center justify-between text-base font-extrabold text-foreground">
                    <span>{s.total}</span><span>₹{rs(q.to_pay)}</span>
                  </div>
                </>
              ) : quoteErr ? (
                <p className="mt-2 text-sm font-semibold text-destructive">{errText(quoteErr)}</p>
              ) : address ? (
                <div className="mt-2 h-16 animate-pulse rounded-[10px] bg-muted" />
              ) : (
                row(s.itemTotal, `₹${rs(cart.total)}`)
              )}
            </section>
            <button type="button" onClick={() => setPolicyOpen(true)}
              className="mt-3 flex w-full items-center justify-between rounded-[16px] bg-card px-4 py-3.5 text-sm font-bold text-primary shadow-soft">
              {lang === "mr" ? "रद्द करण्याचे धोरण" : "Cancellation policy"} <ChevronRight className="h-4 w-4" />
            </button>
            <CancellationPolicySheet open={policyOpen} onClose={() => setPolicyOpen(false)} serviceKey={isFood ? "food" : "store"} />
          </>
        )}
      </div>

      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.06)] safe-bottom">
          <div className="mx-auto flex w-full max-w-md items-center gap-4 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{s.total}</span>
              <span className="text-lg font-extrabold text-foreground">₹{rs(total)}</span>
            </div>
            <button
              type="button"
              onClick={() => void pay()}
              disabled={placing || (address != null && (!q || isFetching))}
              className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-primary py-3.5 text-base font-extrabold text-primary-foreground active:scale-[0.99] disabled:opacity-60"
            >
              {placing && <Loader2 className="h-4 w-4 animate-spin" />}
              {address == null ? s.addAddress : walletOnly ? s.payWallet : fill(s.pay, "n", rs(total))}
            </button>
          </div>
        </div>
      )}
      {couponSheet}
    </main>
  );
}
