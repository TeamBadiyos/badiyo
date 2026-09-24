/**
 * Cart + checkout for a shop order: items, delivery address, bill and payment.
 * Prices shown here are re-computed by the database when the order is placed.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, MapPin, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { hapticImpact } from "@/lib/haptics";
import { useStoreCart } from "@/lib/storeCart";
import { StoreImage } from "./StoreImage";
import {
  attachStorePayment,
  confirmStorePayment,
  createStoreOrder,
  StoreOrderError,
  useDeliveryQuote,
} from "@/lib/storeOrders";
import { getPaymentPrefill } from "@/lib/paymentPrefill";
import { payWithRazorpay, PaymentCancelledError } from "@/lib/razorpayCheckout";
import type { TranslationKey } from "@/i18n/en";

type Address = {
  id: string;
  label: string | null;
  full_address: string | null;
  area: string | null;
  city: string | null;
  is_default: boolean | null;
};

async function fetchAddresses(): Promise<Address[]> {
  const { data: userRes } = await getAuthUser();
  const uid = userRes.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, full_address, area, city, is_default")
    .eq("user_id", uid)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Address[];
}

const ERROR_KEYS: Record<string, TranslationKey> = {
  store_closed: "store.errStoreClosed",
  store_unavailable: "store.errStoreClosed",
  out_of_stock: "store.errOutOfStock",
  product_unavailable: "store.errProduct",
  below_min_order: "store.errMinOrder",
  bad_address: "store.errAddress",
};

export function StoreCartScreen({
  onBack,
  onAddAddress,
  onDone,
}: {
  onBack: () => void;
  onAddAddress: () => void;
  /** Called after a successful order so the app can show the Orders tab. */
  onDone: () => void;
}) {
  const t = useT();
  const cart = useStoreCart();
  const queryClient = useQueryClient();
  const [addressId, setAddressId] = useState<string | null>(null);
  const [mode, setMode] = useState<"cod" | "online">("cod");
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);

  const { data: addresses = [], isLoading: loadingAddresses } = useQuery({
    queryKey: ["my-addresses"],
    queryFn: fetchAddresses,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!addressId && addresses.length > 0) setAddressId(addresses[0].id);
  }, [addresses, addressId]);

  const itemsTotal = cart.total;
  const { data: quote } = useDeliveryQuote(itemsTotal);
  const fee = quote?.delivery_fee ?? 0;
  const payable = itemsTotal + fee;

  const address = useMemo(
    () => addresses.find((a) => a.id === addressId) ?? null,
    [addresses, addressId],
  );

  const showError = (code: string) => {
    const key = ERROR_KEYS[code] ?? "store.errGeneric";
    toast.error(t(key));
  };

  async function placeOrder() {
    if (placing) return;
    if (!cart.cart.merchantId || cart.lines().length === 0) return;
    if (!addressId) {
      toast.error(t("store.errAddress"));
      return;
    }
    setPlacing(true);
    void hapticImpact("medium");
    try {
      const created = await createStoreOrder({
        merchantId: cart.cart.merchantId,
        lines: cart.cart.lines,
        addressId,
        paymentMode: mode,
        note: note.trim() || null,
      });

      if (mode === "online") {
        const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
          body: {
            purpose: "store_order",
            store_order_id: created.order_id,
            currency: "INR",
            receipt: created.order_number,
          },
        });
        if (error || !data?.order_id || !data?.key_id) {
          throw new Error(error?.message ?? "payment_init_failed");
        }
        await attachStorePayment(created.order_id, data.order_id as string);
        const prefill = await getPaymentPrefill();
        const resp = await payWithRazorpay({
          key: data.key_id,
          order_id: data.order_id,
          amount: data.amount,
          currency: data.currency,
          description: cart.cart.storeName ?? "badiyos store",
          contact: prefill.contact,
          email: prefill.email,
          customerName: prefill.name,
        });
        await confirmStorePayment(
          created.order_id,
          resp.razorpay_order_id,
          resp.razorpay_payment_id,
        );
      }

      cart.clear();
      void queryClient.invalidateQueries({ queryKey: ["my-store-orders"] });
      toast.success(t("store.orderPlaced"), {
        description: t("store.orderPlacedBody", { number: created.order_number }),
      });
      onDone();
    } catch (err) {
      if (err instanceof PaymentCancelledError) {
        // The order stays unpaid in "Your Orders" — nothing to shout about.
        void queryClient.invalidateQueries({ queryKey: ["my-store-orders"] });
        onDone();
        return;
      }
      if (err instanceof StoreOrderError) showError(err.code);
      else {
        console.error("[store] place order failed", err);
        toast.error(t("store.errGeneric"));
      }
    } finally {
      setPlacing(false);
    }
  }

  const empty = cart.cart.lines.length === 0;

  return (
    <main className="min-h-screen w-full bg-background pb-40 momentum-scroll">
      <div className="mx-auto w-full max-w-md px-5 pt-2">
        <header
          className="bleed-safe-top sticky top-0 z-30 -mx-5 flex items-center gap-3 bg-background px-5 pb-3"
          style={{ "--bleed-top-extra": "16px" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-foreground">{t("store.yourCart")}</p>
            {cart.cart.storeName && (
              <p className="truncate text-xs text-muted-foreground">{cart.cart.storeName}</p>
            )}
          </div>
        </header>

        {empty ? (
          <div className="mt-8 flex flex-col items-center rounded-[18px] border border-dashed border-border bg-card px-6 py-14 text-center">
            <ShoppingBag className="h-8 w-8 text-primary" />
            <p className="mt-3 text-sm font-bold text-foreground">{t("store.cartEmpty")}</p>
          </div>
        ) : (
          <>
            <ul className="mt-3 space-y-2">
              {cart.cart.lines.map((l) => (
                <li
                  key={l.product_id}
                  className="flex items-center gap-3 rounded-[18px] border border-border bg-card p-2.5"
                >
                  <StoreImage
                    path={l.photo_url}
                    variant="product"
                    alt={l.name}
                    className="h-12 w-12 shrink-0 rounded-[12px]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-foreground">{l.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{l.unit ?? ""}</p>
                    <p className="mt-0.5 text-[13px] font-extrabold text-foreground">
                      ₹{(l.price * l.quantity).toFixed(0)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-1 py-1 text-primary-foreground">
                    <button
                      type="button"
                      aria-label="-"
                      onClick={() => {
                        void hapticImpact("light");
                        cart.setQuantity(l.product_id, l.quantity - 1);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full active:scale-90"
                    >
                      <Minus className="h-3.5 w-3.5" strokeWidth={3} />
                    </button>
                    <span className="min-w-5 text-center text-[13px] font-extrabold tabular-nums">
                      {l.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="+"
                      onClick={() => {
                        void hapticImpact("light");
                        cart.setQuantity(l.product_id, l.quantity + 1);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full active:scale-90"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={3} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {/* Delivery address */}
            <section className="mt-4 rounded-[18px] border border-border bg-card p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("store.deliverTo")}
              </p>
              {loadingAddresses ? (
                <Loader2 className="mt-2 h-4 w-4 animate-spin text-primary" />
              ) : addresses.length === 0 ? (
                <button
                  type="button"
                  onClick={onAddAddress}
                  className="mt-2 w-full rounded-[14px] border border-dashed border-primary/40 px-3 py-3 text-sm font-bold text-primary"
                >
                  {t("store.noAddress")}
                </button>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {addresses.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setAddressId(a.id)}
                        className={
                          "flex w-full items-start gap-2 rounded-[14px] border px-3 py-2.5 text-left " +
                          (a.id === addressId
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background")
                        }
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          {a.label && (
                            <span className="block text-[12px] font-bold text-foreground">
                              {a.label}
                            </span>
                          )}
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {[a.full_address, a.area, a.city].filter(Boolean).join(", ")}
                          </span>
                        </span>
                        {a.id === addressId && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Note */}
            <section className="mt-3">
              <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("store.noteLabel")}
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 200))}
                placeholder={t("store.notePlaceholder")}
                className="mt-1.5 w-full rounded-[14px] border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </section>

            {/* Payment mode */}
            <section className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("store.payment")}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["online", "cod"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={
                      "rounded-[14px] border px-3 py-3 text-[13px] font-bold " +
                      (mode === m
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-card text-foreground")
                    }
                  >
                    {m === "online" ? t("store.payOnline") : t("store.payCod")}
                  </button>
                ))}
              </div>
            </section>

            {/* Bill */}
            <section className="mt-4 rounded-[18px] border border-border bg-card p-3.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{t("store.itemsTotal")}</span>
                <span className="font-semibold text-foreground">₹{itemsTotal.toFixed(0)}</span>
              </div>
              <div className="mt-1.5 flex justify-between text-muted-foreground">
                <span>{t("store.deliveryFee")}</span>
                <span className="font-semibold text-foreground">
                  {fee === 0 ? t("store.freeDelivery") : `₹${fee.toFixed(0)}`}
                </span>
              </div>
              {quote && quote.free_delivery_above > 0 && fee > 0 && (
                <p className="mt-1 text-[11px] text-primary">
                  {t("store.freeAbove", { amount: String(quote.free_delivery_above) })}
                </p>
              )}
              <div className="mt-2.5 flex justify-between border-t border-border pt-2.5 text-base font-extrabold text-foreground">
                <span>{t("store.toPay")}</span>
                <span>₹{payable.toFixed(0)}</span>
              </div>
            </section>
          </>
        )}
      </div>

      {!empty && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-background via-background to-transparent px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4">
          <button
            type="button"
            onClick={placeOrder}
            disabled={placing || !addressId}
            className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-[18px] bg-primary px-4 py-3.5 text-sm font-extrabold text-primary-foreground shadow-lg transition active:scale-[0.99] disabled:opacity-60"
          >
            {placing && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("store.placeOrder")} · ₹{payable.toFixed(0)}
          </button>
        </div>
      )}
    </main>
  );
}
