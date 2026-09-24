// Customer tracking for a shop order. Reuses the parcel tracking pieces
// (live rider map, rider info, delivery code) from the linked delivery job.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, MapPin, Phone, ShieldCheck, Store, UserRound, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { refreshCourierOtp } from "@/lib/courierOtp.functions";
import { fetchStoreOrder } from "@/lib/storeOrders";
import { CourierLiveMap } from "../courier/CourierLiveMap";
import { fetchCourierOrder, fetchCourierOtp, fetchRiderInfo } from "../courier/courierData";

const STEPS = ["Order placed", "Store accepted", "Rider assigned", "Picked up", "Delivered"];

function stepIndex(status: string): number {
  switch (status) {
    case "placed":
    case "paid":
      return 0;
    case "accepted":
    case "needs_attention":
      return 1;
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
  const idx = stepIndex(status);
  const riderVisible = !!job?.assigned_expert_id && idx >= 2 && idx < 4;
  const refundDone = order.refund_status === "done";

  return (
    <div className="min-h-dvh bg-background pb-16">
      <div className="bleed-safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 pb-3 [--bleed-top-extra:12px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-base font-bold text-foreground">
            <Store className="h-4 w-4 text-primary" />
            {order.store_name ?? "Store order"}
          </p>
          <p className="text-xs text-muted-foreground">#{order.order_number}</p>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {cancelled ? (
          <div className="rounded-[18px] border border-destructive/30 bg-destructive/5 p-4">
            <p className="flex items-center gap-2 text-base font-bold text-destructive">
              <XCircle className="h-5 w-5" /> Order cancel ho gaya, refund 5-7 din me aa jayega
            </p>
            {(order.reject_reason || order.cancel_reason) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Reason: {order.reject_reason ?? order.cancel_reason}
              </p>
            )}
            <p className="mt-2 text-xs font-semibold text-foreground">
              {refundDone ? "Refund ho gaya" : "Refund in progress"}
            </p>
          </div>
        ) : awaitingPayment ? (
          <div className="rounded-[18px] border border-border bg-card p-4 text-sm">
            <p className="flex items-center gap-2 font-bold text-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Waiting for payment confirmation
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Payment confirm hote hi order dukaan ko bhej diya jayega.
            </p>
          </div>
        ) : (
          <ol className="rounded-[18px] border border-border bg-card p-4">
            {STEPS.map((label, i) => {
              const done = i <= idx;
              return (
                <li key={label} className="flex items-center gap-3 py-1.5">
                  <span
                    className={
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                      (done ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground")
                    }
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={"text-sm " + (i === idx ? "font-bold text-foreground" : done ? "text-foreground" : "text-muted-foreground")}>
                    {label}
                  </span>
                </li>
              );
            })}
            {status === "needs_attention" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Rider dhoondhne me thoda samay lag raha hai. Hamari team dekh rahi hai.
              </p>
            )}
          </ol>
        )}

        {showOtp && !cancelled && (
          <div className="rounded-[18px] border-2 border-primary/40 bg-primary/5 p-4 text-center">
            <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" /> Delivery OTP
            </p>
            <div className="mt-3 flex justify-center gap-3">
              {(otp ?? "••••").split("").map((d, i) => (
                <div
                  key={i}
                  className="flex h-14 w-12 items-center justify-center rounded-2xl border-2 border-primary/30 bg-card text-2xl font-extrabold text-primary"
                >
                  {d}
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">Rider ko ye OTP delivery pe batayein</p>
          </div>
        )}

        {riderVisible && job && (
          <>
            <CourierLiveMap
              orderId={job.id}
              status={job.status}
              pickup={{ lat: job.pickup_lat, lng: job.pickup_lng, label: order.store_name ?? "Store" }}
              drop={{ lat: job.drop_lat, lng: job.drop_lng, label: "You" }}
            />
            <div className="flex items-center gap-3 rounded-[18px] border border-border bg-card p-3">
              {rider?.photo_url ? (
                <img src={rider.photo_url} alt="" className="h-11 w-11 rounded-full object-cover" />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                  <UserRound className="h-5 w-5 text-primary" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{rider?.name ?? "Your rider"}</p>
                <p className="text-xs text-muted-foreground">badiyos Expert</p>
              </div>
              {rider?.phone && (
                <a
                  href={`tel:${rider.phone}`}
                  aria-label="Call rider"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
            </div>
          </>
        )}

        <div className="rounded-[18px] border border-border bg-card p-4 text-sm">
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
            <div className="flex justify-between"><span>Items</span><span className="text-foreground">₹{order.items_total.toFixed(0)}</span></div>
            <div className="flex justify-between"><span>Delivery fee</span><span className="text-foreground">₹{order.delivery_fee.toFixed(0)}</span></div>
            <div className="flex justify-between pt-1 text-base font-extrabold text-foreground"><span>Total</span><span>₹{order.total_amount.toFixed(0)}</span></div>
            <p className="text-xs">{order.payment_status === "paid" ? "Paid online" : order.payment_status?.startsWith("refund") ? "Refund in progress" : "Online payment"}</p>
          </div>
          {order.delivery_address && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {order.delivery_address}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
