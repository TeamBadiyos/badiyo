// Live parcel tracking for the customer: stage tracker, live rider map,
// prominent in-app OTP, rider card, route + fare summary and cancel.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MessageCircle,
  Package,
  Phone,
  ReceiptText,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { BillSheet } from "@/components/BillSheet";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { refreshCourierOtp } from "@/lib/courierOtp.functions";
import { CourierLiveMap } from "./CourierLiveMap";
import { courierGetOrderOtps } from "@/lib/courier.functions";
import {
  StopsTimeline,
  ReturnChargeCard,
  currentStopId,
  parcelSummary,
} from "./StopsTimeline";
import {
  fetchCourierOrder,
  fetchCourierOtp,
  fetchRiderInfo,
  fetchCourierStops,
  fetchCourierParcels,
  fetchCourierCharges,
  COURIER_STAGES,
  courierStageIndex,
  courierBillLines,
} from "./courierData";
import { useT, type TFunction } from "@/i18n";

type Purpose = "pickup" | "delivery";

function OtpDigits({ code }: { code: string | null }) {
  const digits = (code ?? "••••").split("");
  return (
    <div className="mt-4 flex justify-center gap-3">
      {digits.map((d, i) => (
        <div
          key={i}
          className="flex h-14 w-12 items-center justify-center rounded-2xl border-2 border-primary/30 bg-primary/5 text-2xl font-extrabold text-primary"
        >
          {d}
        </div>
      ))}
    </div>
  );
}

/** Turn any stored phone into a WhatsApp-ready number (91XXXXXXXXXX). */
function waNumber(raw?: string | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

function pickupWhatsappText(name: string | null | undefined, code: string, t: TFunction) {
  const who = (name ?? "").trim();
  return t("courier.whatsappPickup", { who: who ? ` ${who}` : "", code });
}

function deliveryWhatsappText(senderName: string | null | undefined, code: string, t: TFunction) {
  const sender = (senderName ?? "").trim() || t("courier.contactPickupRole");
  return t("courier.whatsappDelivery", { sender, code });
}

function openWhatsapp(phone: string | null, text: string) {
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function CourierTrackingScreen({
  orderId,
  onBack,
}: {
  orderId: string;
  onBack: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { data: order, isLoading } = useQuery({
    queryKey: ["courier_order", orderId],
    queryFn: () => fetchCourierOrder(orderId),
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const status = order?.status ?? "REQUESTED";

  // Realtime: react instantly when the rider moves the order forward.
  useEffect(() => {
    const channel = supabase
      .channel(`courier-track-${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "courier_orders", filter: `id=eq.${orderId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["courier_order", orderId] });
          void qc.invalidateQueries({ queryKey: ["my-courier-orders"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, qc]);

  const { data: rider } = useQuery({
    queryKey: ["courier-rider-info", orderId, order?.assigned_expert_id],
    queryFn: () => fetchRiderInfo(orderId),
    enabled: !!order?.assigned_expert_id,
    staleTime: 60_000,
  });

  const otpPurpose: Purpose | null =
    status === "ARRIVED_PICKUP"
      ? "pickup"
      : status === "PICKED_UP" || status === "IN_TRANSIT"
        ? "delivery"
        : null;

  // The code is pulled straight into the app — no WhatsApp step needed.
  const { data: otp } = useQuery({
    queryKey: ["courier-otp", orderId, otpPurpose],
    queryFn: async () => {
      if (!otpPurpose) return null;
      const existing = await fetchCourierOtp(orderId, otpPurpose);
      if (existing) return existing;
      const issued = await refreshCourierOtp({
        data: { order_id: orderId, purpose: otpPurpose },
      });
      return issued?.otp ?? null;
    },
    enabled: !!otpPurpose,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const [cancelling, setCancelling] = useState(false);
  const [billOpen, setBillOpen] = useState(false);

  // Multi-stop data (stops, parcels, return charges, per-stop OTPs).
  const { data: stops = [] } = useQuery({
    queryKey: ["courier-stops", orderId],
    queryFn: () => fetchCourierStops(orderId),
    refetchInterval: 8000,
    refetchIntervalInBackground: false,
  });
  const isMultiOrder =
    stops.length > 2 || stops.some((st) => st.stop_type === "return");
  const { data: parcels = [] } = useQuery({
    queryKey: ["courier-parcels", orderId, status],
    queryFn: () => fetchCourierParcels(orderId),
    enabled: isMultiOrder,
  });
  const { data: charges = [] } = useQuery({
    queryKey: ["courier-charges", orderId],
    queryFn: () => fetchCourierCharges(orderId),
    refetchInterval: (q) =>
      (q.state.data ?? []).some((c) => c.status === "pending") ? 10_000 : 30_000,
  });
  const { data: stopOtps = {} } = useQuery({
    queryKey: ["courier-order-otps", orderId, status],
    queryFn: async () => {
      const rows = (await courierGetOrderOtps({ data: { order_id: orderId } })) as Array<{
        stop_id: string;
        otp: string | null;
      }>;
      return Object.fromEntries(rows.map((r) => [r.stop_id, r.otp])) as Record<string, string | null>;
    },
    enabled: isMultiOrder,
    refetchInterval: 15_000,
  });

  const stageIdx = useMemo(() => courierStageIndex(status), [status]);
  const failedDelivery = status === "FAILED_DELIVERY";
  const cancelled =
    status === "CANCELLED" || status === "EXPIRED" || status === "FAILED" || failedDelivery;
  const allPickupsFailed = order?.cancel_reason_code === "ALL_PICKUPS_FAILED";
  const done = status === "DELIVERED" || status === "COMPLETED";
  const searching = status === "REQUESTED" || status === "SEARCHING";
  const canCancel = ["REQUESTED", "SEARCHING", "DRIVER_ASSIGNED", "ARRIVED_PICKUP"].includes(status);

  const cancelOrder = async () => {
    setCancelling(true);
    try {
      const { error } = await supabase.rpc("courier_cancel_order", {
        _order_id: orderId,
        _reason: "customer_cancelled",
      });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["courier_order", orderId] });
      await qc.invalidateQueries({ queryKey: ["my-courier-orders"] });
      toast(t("courier.cancelledToast"));
    } catch (e) {
      toast.error((e as Error).message || t("courier.genericError"));
    } finally {
      setCancelling(false);
    }
  };

  const liveStatuses = ["DRIVER_ASSIGNED", "ARRIVED_PICKUP", "PICKED_UP", "IN_TRANSIT"];
  const curStop = currentStopId(stops, !!order?.assigned_expert_id, liveStatuses.includes(status));
  const chargeCards = charges
    .filter((c) => c.status === "pending" || c.status === "paid")
    .map((c) => {
      const parcel = parcels.find((p) => p.id === c.parcel_id);
      const drops = stops.filter((st) => st.stop_type === "drop");
      const idx = drops.findIndex((d) => d.id === parcel?.drop_stop_id);
      return { charge: c, label: idx >= 0 ? t("courier.dropN", { n: idx + 1 }) : t("courier.dropFallback") };
    });
  const summary = isMultiOrder ? parcelSummary(parcels, t) : null;
  const stageLabels = [
    t("courier.stagePlaced"),
    t("courier.stageRider"),
    t("courier.stagePickup"),
    t("courier.stageOnWay"),
    t("courier.stageDelivered"),
  ];

  if (isLoading || !order) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background pb-28">
      <div className="bleed-safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 pb-3 [--bleed-top-extra:12px]">
        <button type="button" onClick={onBack} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">
            {order.order_code ? t("courier.parcelNumber", { code: order.order_code }) : t("courier.parcel")}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {cancelled
              ? t("courier.statusCancelled")
              : done
                ? t("courier.statusDelivered")
                : stageLabels[stageIdx] ?? t("courier.inProgress")}
          </p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {chargeCards.map(({ charge, label }) => (
          <ReturnChargeCard key={charge.id} orderId={orderId} charge={charge} dropLabel={label} />
        ))}

        {/* Stage tracker */}
        {!cancelled && (
          <div className="rounded-[20px] border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              {COURIER_STAGES.map((s, i) => {
                const complete = i < stageIdx || (done && i === COURIER_STAGES.length - 1);
                const active = i === stageIdx;
                return (
                  <div key={s.key} className="flex flex-1 flex-col items-center">
                    <div className="flex w-full items-center">
                      <div
                        className={`h-[2px] flex-1 ${
                          i === 0 ? "bg-transparent" : complete || active ? "bg-primary" : "bg-border"
                        }`}
                      />
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                          complete
                            ? "border-primary bg-primary text-primary-foreground"
                            : active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        {complete ? <Check className="h-3 w-3" /> : i + 1}
                      </div>
                      <div
                        className={`h-[2px] flex-1 ${
                          i === COURIER_STAGES.length - 1
                            ? "bg-transparent"
                            : complete
                              ? "bg-primary"
                              : "bg-border"
                        }`}
                      />
                    </div>
                    <div
                      className={`mt-1.5 text-center text-[10px] font-medium ${
                        active ? "text-primary" : complete ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {stageLabels[i]}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {cancelled && (
          <div className="flex items-start gap-3 rounded-[20px] border border-destructive/30 bg-destructive/5 p-4">
            <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-destructive">
                {failedDelivery
                  ? t("courier.failedDelivery")
                  : allPickupsFailed
                    ? t("courier.failedPickup")
                    : t("courier.orderCancelled")}
              </p>
              {!failedDelivery && !allPickupsFailed && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("courier.refundNote")}
                </p>
              )}
              {summary && <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>}
            </div>
          </div>
        )}

        {done && (
          <div className="flex items-start gap-3 rounded-[20px] border border-primary/30 bg-primary/5 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-primary">{t("courier.deliveredTitle")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {order.delivered_at
                  ? new Date(order.delivered_at).toLocaleString()
                  : t("courier.thanks")}
              </p>
              {summary && <p className="mt-0.5 text-xs font-semibold text-foreground">{summary}</p>}
            </div>
          </div>
        )}

        {/* Searching animation */}
        {searching && (
          <div className="flex flex-col items-center rounded-[20px] border border-border bg-card p-6 text-center">
            <div className="relative flex h-20 w-20 items-center justify-center">
              <span className="absolute inline-flex h-20 w-20 animate-ping rounded-full bg-primary/20" />
              <span className="absolute inline-flex h-14 w-14 rounded-full bg-primary/10" />
              <Package className="relative h-7 w-7 text-primary" />
            </div>
            <p className="mt-4 text-sm font-semibold">{t("courier.findingPartner")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("courier.findingPartnerHint")}
            </p>
          </div>
        )}

        {/* Live map */}
        {!cancelled && !searching && (
          <CourierLiveMap
            orderId={orderId}
            status={status}
            pickup={{
              lat: order.pickup_lat,
              lng: order.pickup_lng,
              label: order.pickup_address,
            }}
            drop={{ lat: order.drop_lat, lng: order.drop_lng, label: order.drop_address }}
          />
        )}

        {isMultiOrder && (
          <StopsTimeline
            orderId={orderId}
            stops={stops}
            otps={stopOtps}
            currentId={curStop}
            editable={!cancelled && !done}
          />
        )}

        {/* Big in-app OTP */}
        {otpPurpose && !isMultiOrder && (
          <div className="rounded-[20px] border-2 border-primary/30 bg-card p-5 text-center">
            <div className="flex items-center justify-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <p className="text-sm font-bold">
                {otpPurpose === "pickup" ? t("courier.pickupCode") : t("courier.deliveryCode")}
              </p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {otpPurpose === "pickup"
                ? t("courier.otpPickupHint")
                : t("courier.otpDeliveryHint")}
            </p>
            <OtpDigits code={otp ?? null} />
            {otp && (
              <button
                type="button"
                onClick={() => {
                  if (otpPurpose === "pickup") {
                    openWhatsapp(
                      waNumber(order.pickup_contact_phone),
                      pickupWhatsappText(order.pickup_contact_name, otp, t),
                    );
                  } else {
                    openWhatsapp(
                      waNumber(order.drop_contact_phone),
                      deliveryWhatsappText(order.pickup_contact_name, otp, t),
                    );
                  }
                }}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" />
                {otpPurpose === "pickup" ? t("courier.shareWhatsapp") : t("courier.sendCodeWhatsapp")}
              </button>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              {t("courier.otpSafety")}
            </p>
          </div>
        )}

        {/* Rider card */}
        {rider?.available && !cancelled && (
          <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
              {rider.photo_url ? (
                <img src={rider.photo_url} alt={rider.name ?? t("courier.rider")} className="h-full w-full object-cover" />
              ) : (
                <UserRound className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{rider.name ?? t("courier.deliveryPartner")}</p>
              <p className="text-xs text-muted-foreground">{t("courier.yourDeliveryPartner")}</p>
            </div>
            {rider.phone && (
              <a
                href={`tel:${rider.phone}`}
                className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
              >
                <Phone className="h-4 w-4" />
                {t("courier.call")}
              </a>
            )}
          </div>
        )}

        {/* Route + fare */}
        <div className="rounded-[20px] border border-border bg-card p-4 text-sm">
          {!isMultiOrder && (<div className="flex gap-3">
            <div className="flex flex-col items-center pt-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span className="my-1 w-px flex-1 bg-border" />
              <span className="h-2.5 w-2.5 rounded-sm bg-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{t("courier.pickup")}</p>
                <p className="text-sm">{order.pickup_address}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{t("courier.drop")}</p>
                <p className="text-sm">{order.drop_address}</p>
              </div>
            </div>
          </div>)}
          <button
            type="button"
            onClick={() => setBillOpen(true)}
            className={isMultiOrder ? "flex w-full items-center justify-between text-sm" : "mt-4 flex w-full items-center justify-between border-t border-border pt-3 text-sm"}
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ReceiptText className="h-4 w-4 text-primary" />
              {order.distance_km ? `${order.distance_km} km` : t("common.total")}
            </span>
            <span className="flex items-center gap-1 font-bold">
              ₹{Number(order.total_amount ?? 0).toFixed(2)}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </span>
          </button>
        </div>
        <BillSheet
          open={billOpen}
          onOpenChange={setBillOpen}
          title="Bill details"
          subtitle={order.order_code ? `#${order.order_code}` : null}
          lines={courierBillLines(order)}
          total={Number(order.total_amount ?? 0)}
          note={order.payment_status === "paid" ? "Paid online" : null}
        />

        {canCancel && (
          <Button variant="outline" className="w-full" disabled={cancelling} onClick={cancelOrder}>
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : t("courier.cancelOrder")}
          </Button>
        )}
        {(status === "PICKED_UP" || status === "IN_TRANSIT") && (
          <p className="text-center text-xs text-muted-foreground">
            {t("courier.cannotCancelPickedUp")}
          </p>
        )}
      </div>
    </div>
  );
}
