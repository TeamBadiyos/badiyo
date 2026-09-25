// "Parcels for you": parcels where the signed-in user is a pickup, drop or
// return contact on someone else's order. No price or payment info here.
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Loader2, Package, Share2, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  courierGetContactView,
  courierGetRiderLocationForStop,
  courierMyContactDeliveries,
} from "@/lib/courier.functions";
import { otpShareText, shareOtp } from "./otpShare";
import type { RiderLocation } from "./courierData";
import { useT, type TFunction } from "@/i18n";

// Google Maps + the live-tracking bundle load only when a rider is actually
// on the way; the Home screen never pays for them.
const CourierLiveMap = lazy(() =>
  import("./CourierLiveMap").then((m) => ({ default: m.CourierLiveMap })),
);


type ContactRow = {
  order_id: string;
  order_code: string | null;
  stop_id: string;
  role: "pickup" | "drop" | "return";
  address: string | null;
  stop_status: string;
  order_status: string;
  sender_label: string | null;
};

type ContactView = {
  stop: {
    stop_id: string;
    stop_type: "pickup" | "drop" | "return";
    address: string | null;
    lat: number | null;
    lng: number | null;
    contact_name: string | null;
    status: string;
  };
  order_id: string;
  order_code: string | null;
  order_status: string;
  rider: { available: boolean; name?: string | null; photo_url?: string | null; vehicle?: string | null };
  is_next_stop: boolean;
  otp: string | null;
  return_stop: { stop_id: string; status: string; otp: string | null } | null;
};

function roleLabel(r: ContactRow["role"], t: TFunction) {
  return r === "drop" ? t("courier.contactDropRole") : r === "pickup" ? t("courier.contactPickupRole") : t("courier.contactReturnRole");
}

function orderStatusLabel(s: string, t: TFunction) {
  const map: Record<string, string> = {
    REQUESTED: t("courier.statusFindingRider"),
    SEARCHING: t("courier.statusFindingRider"),
    DRIVER_ASSIGNED: t("courier.statusRiderAssigned"),
    ARRIVED_PICKUP: t("courier.statusRiderAtPickup"),
    PICKED_UP: t("courier.statusPickedUp"),
    IN_TRANSIT: t("courier.statusOnWay"),
    DELIVERED: t("courier.statusDelivered"),
    COMPLETED: t("courier.statusDelivered"),
    CANCELLED: t("courier.statusCancelled"),
    FAILED_DELIVERY: t("courier.statusNotDelivered"),
  };
  return map[s] ?? s;
}

export function useContactDeliveries() {
  return useQuery({
    queryKey: ["courier-contact-deliveries"],
    queryFn: async () => ((await courierMyContactDeliveries()) as unknown as ContactRow[]) ?? [],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
}

export function ContactParcelsCard({ onOpen }: { onOpen: (stopId?: string) => void }) {
  const t = useT();
  const { data = [] } = useContactDeliveries();
  if (!data.length) return null;
  return (
    <div className="mt-4 rounded-[20px] border-2 border-primary/30 bg-primary/5 p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Package className="h-4 w-4 text-primary" /> {t("courier.contactParcels")}
      </p>
      <div className="mt-2 space-y-2">
        {data.slice(0, 3).map((r) => (
          <button
            key={r.stop_id}
            type="button"
            onClick={() => onOpen(r.stop_id)}
            className="flex w-full items-center gap-3 rounded-xl bg-card p-3 text-left"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{roleLabel(r.role, t)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.sender_label ? `${r.sender_label} · ` : ""}
                {orderStatusLabel(r.order_status, t)}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>
      {data.length > 3 && (
        <button type="button" onClick={() => onOpen()} className="mt-2 text-xs font-bold text-primary">
          {t("courier.seeAll")}
        </button>
      )}
    </div>
  );
}

export function ContactParcelsScreen({
  initialStopId,
  onBack,
}: {
  initialStopId?: string | null;
  onBack: () => void;
}) {
  const t = useT();
  const [stopId, setStopId] = useState<string | null>(initialStopId ?? null);
  const { data = [], isLoading } = useContactDeliveries();

  if (stopId) return <ContactParcelDetail stopId={stopId} onBack={() => setStopId(null)} />;

  return (
    <div className="min-h-dvh bg-background pb-28">
      <Header title={t("courier.contactParcels")} onBack={onBack} />
      <div className="space-y-3 px-4 py-4">
        {isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
        {!isLoading && !data.length && (
          <p className="rounded-2xl bg-muted p-4 text-center text-sm text-muted-foreground">
            {t("courier.noContactParcels")}
          </p>
        )}
        {data.map((r) => (
          <button
            key={r.stop_id}
            type="button"
            onClick={() => setStopId(r.stop_id)}
            className="flex w-full items-center gap-3 rounded-[20px] border border-border bg-card p-4 text-left"
          >
            <Package className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{roleLabel(r.role, t)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {r.sender_label ? t("courier.fromSender", { sender: r.sender_label }) : ""}
                {orderStatusLabel(r.order_status, t)}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="bleed-safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 pb-3 [--bleed-top-extra:12px]">
      <button type="button" onClick={onBack} aria-label="Back">
        <ArrowLeft className="h-5 w-5" />
      </button>
      <h1 className="truncate text-base font-semibold">{title}</h1>
    </div>
  );
}

function OtpBlock({ label, otp, type, address }: { label: string; otp: string; type: "pickup" | "drop" | "return"; address: string | null }) {
  const t = useT();
  return (
    <div className="rounded-[20px] border-2 border-primary/30 bg-card p-5 text-center">
      <div className="flex items-center justify-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" />
        <p className="text-sm font-bold">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-extrabold tracking-[0.4em] text-primary">{otp}</p>
      <Button className="mt-4 w-full" onClick={() => void shareOtp(otpShareText(type, address, otp, t))}>
        <Share2 className="h-4 w-4" /> {t("courier.share")}
      </Button>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {t("courier.otpContactHint")}
      </p>
    </div>
  );
}

function ContactParcelDetail({ stopId, onBack }: { stopId: string; onBack: () => void }) {
  const t = useT();
  const { data, isLoading, error } = useQuery({
    queryKey: ["courier-contact-view", stopId],
    queryFn: async () => (await courierGetContactView({ data: { stop_id: stopId } })) as unknown as ContactView,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="min-h-dvh bg-background pb-28">
      <Header title={data?.order_code ? t("courier.parcelNumber", { code: data.order_code }) : t("courier.parcel")} onBack={onBack} />
      <div className="space-y-4 px-4 py-4">
        {isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />}
        {error && (
          <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            {t("courier.parcelUnavailable")}
          </p>
        )}
        {data && (
          <>
            <div className="rounded-[20px] border border-border bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground">
                {roleLabel(data.stop.stop_type, t)}
              </p>
              <p className="mt-1 text-lg font-extrabold">{orderStatusLabel(data.order_status, t)}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{data.stop.address}</p>
            </div>

            {data.otp && (
              <OtpBlock
                label={data.stop.stop_type === "pickup" ? t("courier.pickupCode") : data.stop.stop_type === "drop" ? t("courier.deliveryCode") : t("courier.returnCode")}
                otp={data.otp}
                type={data.stop.stop_type}
                address={data.stop.address}
              />
            )}
            {data.return_stop?.otp && (
              <OtpBlock label={t("courier.returnCode")} otp={data.return_stop.otp} type="return" address={data.stop.address} />
            )}

            {data.rider?.available && (
              <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                  {data.rider.photo_url ? (
                    <img src={data.rider.photo_url} alt={data.rider.name ?? t("courier.rider")} className="h-full w-full object-cover" />
                  ) : (
                    <UserRound className="h-6 w-6 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{data.rider.name ?? t("courier.deliveryPartner")}</p>
                  <p className="text-xs text-muted-foreground">{data.rider.vehicle ?? t("courier.badiyosRider")}</p>
                </div>
              </div>
            )}

            {data.rider?.available &&
              (data.is_next_stop ? (
                <Suspense
                  fallback={<div className="h-48 animate-pulse rounded-[20px] bg-muted" />}
                >
                  <CourierLiveMap
                    orderId={`contact-${stopId}`}
                    status={data.order_status}
                    pickup={
                      data.stop.stop_type === "pickup"
                        ? { lat: data.stop.lat, lng: data.stop.lng, label: data.stop.address ?? "" }
                        : { lat: null, lng: null, label: "" }
                    }
                    drop={
                      data.stop.stop_type === "pickup"
                        ? { lat: null, lng: null, label: "" }
                        : { lat: data.stop.lat, lng: data.stop.lng, label: data.stop.address ?? "" }
                    }
                    fetchLocation={async () =>
                      (await courierGetRiderLocationForStop({ data: { stop_id: stopId } })) as unknown as RiderLocation
                    }
                  />
                </Suspense>

              ) : (
                !["DELIVERED", "COMPLETED", "CANCELLED", "FAILED_DELIVERY"].includes(data.order_status) && (
                  <p className="rounded-2xl bg-muted p-4 text-center text-sm text-muted-foreground">
                    {t("courier.afterCurrentStop")}
                  </p>
                )
              ))}
          </>
        )}
      </div>
    </div>
  );
}
