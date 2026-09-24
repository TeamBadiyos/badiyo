// Customer tracking for a shop order — quick-commerce style live flow.
// Reuses the parcel tracking pieces (live rider map, rider info, delivery code)
// from the linked delivery job.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bike,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { refreshCourierOtp } from "@/lib/courierOtp.functions";
import { fetchStoreOrder } from "@/lib/storeOrders";
import { CourierLiveMap } from "../courier/CourierLiveMap";
import { fetchCourierOrder, fetchCourierOtp, fetchRiderInfo } from "../courier/courierData";

type Step = {
  key: string;
  label: string;
  icon: typeof ShoppingBag;
  title: string;
  sub: string;
};

const STEPS: Step[] = [
  {
    key: "placed",
    label: "Placed",
    icon: ShoppingBag,
    title: "Order confirm ho gaya",
    sub: "Dukaan ko aapka order bhej diya gaya hai.",
  },
  {
    key: "accepted",
    label: "Packing",
    icon: Package,
    title: "Dukaan order pack kar rahi hai",
    sub: "Saman taiyaar ho raha hai, thoda intezaar karein.",
  },
  {
    key: "rider",
    label: "Rider",
    icon: Bike,
    title: "Badiyos Expert assign ho gaya",
    sub: "Rider dukaan se order lene ja raha hai.",
  },
  {
    key: "picked",
    label: "On the way",
    icon: Bike,
    title: "Order raste me hai",
    sub: "Rider aapke pate par aa raha hai.",
  },
  {
    key: "delivered",
    label: "Delivered",
    icon: PackageCheck,
    title: "Order deliver ho gaya",
    sub: "Badiyos chunne ke liye dhanyavaad!",
  },
];

function stepIndex(status: string): number {
  switch (status) {
    case "placed":
    case "paid":
      return 0;
    case "accepted":
    case "needs_attention":
      return 1;
    case "ready":
      return -2; // resolved below from the delivery job
    case "expert_assigned":
      return 2;
    case "picked_up":
      return 3;
    case "delivered":
    case "completed":
      return 4;
    default:
      return -1;
  }
}

export function StoreOrderTrackingScreen({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [billOpen, setBillOpen] = useState(false);
  const { data: order, isLoading } = useQuery({
    queryKey: ["store-order", orderId],
    queryFn: () => fetchStoreOrder(orderId),
    refetchInterval: 10_000,
    staleTime: 0,
  });

  const courierId = order?.courier_order_id ?? null;
  const { data: job } = useQuery({
    queryKey: ["courier_order", courierId],
    queryFn: () => fetchCourierOrder(courierId!),
    enabled: !!courierId,
    refetchInterval: 8000,
    staleTime: 0,
  });

  useEffect(() => {
    if (!courierId) return;
    const channel = supabase
      .channel(`store-track-${courierId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "courier_orders", filter: `id=eq.${courierId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["courier_order", courierId] });
          void qc.invalidateQueries({ queryKey: ["store-order", orderId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [courierId, orderId, qc]);

  const { data: rider } = useQuery({
    queryKey: ["courier-rider-info", courierId, job?.assigned_expert_id],
    queryFn: () => fetchRiderInfo(courierId!),
    enabled: !!courierId && !!job?.assigned_expert_id,
    staleTime: 60_000,
  });

  const jobStatus = job?.status ?? "";
  const showOtp = jobStatus === "PICKED_UP" || jobStatus === "IN_TRANSIT";
  const { data: otp } = useQuery({
    queryKey: ["courier-otp", courierId, "delivery"],
    queryFn: async () => {
      const existing = await fetchCourierOtp(courierId!, "delivery");
      if (existing) return existing;
      const issued = await refreshCourierOtp({ data: { order_id: courierId!, purpose: "delivery" } });
      return issued?.otp ?? null;
    },
    enabled: !!courierId && showOtp,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading || !order) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const status = order.status;
  const cancelled = status === "rejected" || status === "cancelled";
  const awaitingPayment = status === "pending";
  const rawIdx = stepIndex(status);
  const idx = rawIdx === -2 ? (job?.assigned_expert_id ? 2 : 1) : rawIdx;
  const riderVisible = !!job?.assigned_expert_id && idx >= 2 && idx < 4;
  const searchingRider = idx === 1 && !job?.assigned_expert_id;
  const refundDone = order.refund_status === "done";
  const delivered = idx >= 4;
  const active = STEPS[Math.max(0, Math.min(idx, STEPS.length - 1))];

  const copyOtp = async () => {
    if (!otp) return;
    try {
      await navigator.clipboard.writeText(otp);
      toast.success("OTP copy ho gaya");
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="min-h-dvh bg-muted/30 pb-20">
      {/* Header */}
      <div className="bleed-safe-top sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/90 px-4 pb-3 backdrop-blur [--bleed-top-extra:12px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-base font-bold text-foreground">
            <Store className="h-4 w-4 shrink-0 text-primary" />
            {order.store_name ?? "Store order"}
          </p>
          <p className="text-xs text-muted-foreground">#{order.order_number}</p>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-3 px-4 pt-4">
        {/* Hero status */}
        {cancelled ? (
          <div className="animate-fade-in rounded-[22px] border border-destructive/30 bg-destructive/5 p-5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10">
              <XCircle className="h-6 w-6 text-destructive" />
            </span>
            <p className="mt-3 text-lg font-extrabold leading-tight text-destructive">
              Order cancel ho gaya
            </p>
            <p className="mt-1 text-sm text-foreground">Refund 5-7 din me aa jayega.</p>
            {(order.reject_reason || order.cancel_reason) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Reason: {order.reject_reason ?? order.cancel_reason}
              </p>
            )}
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-bold text-foreground">
              {refundDone ? "Refund ho gaya" : "Refund in progress"}
            </span>
          </div>
        ) : awaitingPayment ? (
          <div className="animate-fade-in rounded-[22px] border border-border bg-card p-5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </span>
            <p className="mt-3 text-lg font-extrabold leading-tight text-foreground">
              Payment confirm ho raha hai
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm hote hi order dukaan ko bhej diya jayega.
            </p>
          </div>
        ) : (
          <div className="animate-fade-in overflow-hidden rounded-[22px] border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-5">
            <div className="flex items-start gap-3">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
                {!delivered && (
                  <span className="absolute inline-flex h-12 w-12 animate-ping rounded-2xl bg-primary/15" />
                )}
                <active.icon className="relative h-6 w-6 text-primary" />
              </span>
              <div className="min-w-0">
                <p className="text-lg font-extrabold leading-tight text-foreground">{active.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{active.sub}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary transition-all duration-700"
                style={{ width: `${((idx + 1) / STEPS.length) * 100}%` }}
              />
            </div>

            {/* Step chips */}
            <div className="mt-3 flex items-start justify-between gap-1">
              {STEPS.map((s, i) => {
                const done = i < idx;
                const isActive = i === idx;
                return (
                  <div key={s.key} className="flex flex-1 flex-col items-center gap-1">
                    <span
                      className={
                        "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors " +
                        (done
                          ? "border-primary bg-primary text-primary-foreground"
                          : isActive
                            ? "border-primary bg-card text-primary"
                            : "border-border bg-card text-muted-foreground")
                      }
                    >
                      {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <s.icon className="h-4 w-4" />}
                    </span>
                    <span
                      className={
                        "text-center text-[10px] leading-tight " +
                        (isActive ? "font-bold text-primary" : done ? "text-foreground" : "text-muted-foreground")
                      }
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {status === "needs_attention" && (
              <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                Rider dhoondhne me thoda samay lag raha hai. Hamari team dekh rahi hai.
              </p>
            )}
          </div>
        )}

        {/* Finding rider animation */}
        {searchingRider && !cancelled && (
          <div className="flex flex-col items-center rounded-[22px] border border-border bg-card p-6 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-primary/15" />
              <span className="absolute inline-flex h-12 w-12 rounded-full bg-primary/10" />
              <Bike className="relative h-6 w-6 text-primary" />
            </div>
            <p className="mt-3 text-sm font-bold text-foreground">Aas-paas Expert dhoond rahe hain…</p>
            <p className="mt-1 text-xs text-muted-foreground">Ismein aam taur par kuch hi minute lagte hain.</p>
          </div>
        )}

        {/* Delivery OTP */}
        {showOtp && !cancelled && (
          <div className="animate-scale-in rounded-[22px] border-2 border-primary/40 bg-primary/5 p-4 text-center">
            <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" /> Delivery OTP
            </p>
            <div className="mt-3 flex justify-center gap-3">
              {(otp ?? "••••").split("").map((d, i) => (
                <div
                  key={i}
                  className="flex h-14 w-12 items-center justify-center rounded-2xl border-2 border-primary/30 bg-card text-2xl font-extrabold text-primary shadow-sm"
                >
                  {d}
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">Rider ko ye OTP delivery pe batayein</p>
            {otp && (
              <button
                type="button"
                onClick={copyOtp}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-bold text-primary"
              >
                <Copy className="h-3.5 w-3.5" /> Copy OTP
              </button>
            )}
          </div>
        )}

        {/* Live map + rider */}
        {riderVisible && job && (
          <>
            <div className="overflow-hidden rounded-[22px] border border-border">
              <CourierLiveMap
                orderId={job.id}
                status={job.status}
                pickup={{ lat: job.pickup_lat, lng: job.pickup_lng, label: order.store_name ?? "Store" }}
                drop={{ lat: job.drop_lat, lng: job.drop_lng, label: "You" }}
              />
            </div>
            <div className="flex items-center gap-3 rounded-[22px] border border-border bg-card p-3">
              {rider?.photo_url ? (
                <img src={rider.photo_url} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <UserRound className="h-5 w-5 text-primary" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{rider?.name ?? "Your rider"}</p>
                <p className="flex items-center gap-1 text-xs text-primary">
                  <ShieldCheck className="h-3 w-3" /> Badiyos verified Expert
                </p>
              </div>
              {rider?.phone && (
                <a
                  href={`tel:${rider.phone}`}
                  aria-label="Call rider"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
            </div>
          </>
        )}

        {/* Delivery address */}
        {order.delivery_address && (
          <div className="flex items-start gap-2.5 rounded-[22px] border border-border bg-card p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <MapPin className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Delivery at</p>
              <p className="mt-0.5 text-sm text-foreground">{order.delivery_address}</p>
            </div>
          </div>
        )}

        {/* Bill */}
        <div className="overflow-hidden rounded-[22px] border border-border bg-card">
          <button
            type="button"
            onClick={() => setBillOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 p-4 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <ReceiptText className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">
                {order.items.length} item{order.items.length > 1 ? "s" : ""} · ₹{order.total_amount.toFixed(0)}
              </p>
              <p className="text-xs text-muted-foreground">
                {order.payment_status === "paid"
                  ? "Paid online"
                  : order.payment_status?.startsWith("refund")
                    ? "Refund in progress"
                    : "Online payment"}
              </p>
            </div>
            <ChevronDown
              className={"h-4 w-4 shrink-0 text-muted-foreground transition-transform " + (billOpen ? "rotate-180" : "")}
            />
          </button>
          {billOpen && (
            <div className="animate-fade-in border-t border-border p-4 text-sm">
              <ul className="space-y-1.5">
                {order.items.map((i, k) => (
                  <li key={k} className="flex justify-between gap-3">
                    <span className="truncate text-foreground">
                      {i.name} × {i.quantity}
                    </span>
                    <span className="font-semibold text-foreground">₹{(i.price * i.quantity).toFixed(0)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 space-y-1 border-t border-border pt-3 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Items</span>
                  <span className="text-foreground">₹{order.items_total.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery fee</span>
                  <span className="text-foreground">₹{order.delivery_fee.toFixed(0)}</span>
                </div>
                <div className="flex justify-between pt-1 text-base font-extrabold text-foreground">
                  <span>Total</span>
                  <span>₹{order.total_amount.toFixed(0)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
