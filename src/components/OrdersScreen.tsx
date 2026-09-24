import { getAuthUser } from "@/lib/authUser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { CalendarCheck, MapPin, Clock, Package, ReceiptText } from "lucide-react";
import { BillSheet, type BillLine } from "@/components/BillSheet";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "./BottomNav";
import {
  fetchCourierEnabled,
  fetchMyCourierOrders,
  fetchPendingReturnOrderIds,
  COURIER_ACTIVE_STATUSES,
  courierBillLines,
  type CourierOrder,
} from "./courier/courierData";
import { ContactParcelsCard } from "./courier/ContactParcels";
import { useBookingsLive } from "@/lib/useBookingsLive";
import {
  fetchMyStoreOrders,
  fetchStoreDeliveryOtp,
  isStoreOrderActive,
  type StoreOrder,
} from "@/lib/storeOrders";
import { Store as StoreIcon } from "lucide-react";
import { useT } from "@/i18n";

import {
  ACTIVE_TRACKING_STATUSES,
  PAST_STATUSES,
  type BookingRow,
} from "./MyBookingsScreen";

async function fetchBookings(): Promise<BookingRow[]> {
  const { data: userRes } = await getAuthUser();
  const uid = userRes.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, service_label, service_duration_minutes, price, total_amount, status, slot_type, scheduled_date, scheduled_time_slot, created_at, rating, review_text, address_id, razorpay_payment_id, addresses(label, full_address, area, city, latitude, longitude, is_default)",
    )
    .eq("user_id", uid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRow[];
}

function statusPill(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "delivered") return "bg-primary/15 text-primary";
  if (s === "cancelled" || s === "rejected" || s === "expired" || s === "failed")
    return "bg-muted text-muted-foreground";
  return "bg-blue-100 text-blue-700";
}

function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(b: BookingRow): string {
  if (b.slot_type === "scheduled" && b.scheduled_date) {
    const d = new Date(b.scheduled_date);
    const day = d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
    return b.scheduled_time_slot ? `${day} · ${b.scheduled_time_slot}` : day;
  }
  if (b.created_at) {
    return new Date(b.created_at).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return "—";
}

function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** One row in the Orders list — either a home service or a parcel. */
type OrderItem =
  | { kind: "booking"; id: string; createdAt: string | null; booking: BookingRow }
  | { kind: "parcel"; id: string; createdAt: string | null; parcel: CourierOrder }
  | { kind: "store"; id: string; createdAt: string | null; order: StoreOrder };

/** Card for one shop order — same shape as the booking/parcel cards. */
function StoreOrderCard({ order, active, onOpen }: { order: StoreOrder; active: boolean; onOpen?: () => void }) {
  const itemLine = order.items
    .map((i) => `${i.name} x${i.quantity}`)
    .join(", ");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen?.(); }}
      className={
        active
          ? "rounded-[20px] border-2 border-primary/40 bg-primary/5 p-5 shadow-sm"
          : "w-full rounded-[18px] border border-border bg-card p-4 text-left shadow-sm"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 truncate text-base font-bold text-foreground">
            <StoreIcon className="h-4 w-4 shrink-0 text-primary" />
            {order.store_name ?? "Store order"}
            <span className="ml-1 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Store</span>
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {formatStamp(order.created_at)} · #{order.order_number}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(order.status)}`}
        >
          {STORE_STATUS_LABELS[order.status] ?? statusLabel(order.status)}
        </span>
      </div>
      {itemLine && (
        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{itemLine}</p>
      )}
      {order.delivery_address && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="line-clamp-1">{order.delivery_address}</span>
        </div>
      )}
      {order.status === "picked_up" && <StoreDeliveryCode orderId={order.id} />}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">Rs {Number(order.total_amount)}</span>
        <span className="text-xs font-semibold text-muted-foreground">
          {order.payment_mode === "cod"
            ? "Cash on delivery"
            : order.payment_status === "paid"
              ? "Paid online"
              : order.payment_status === "refund_pending" || order.payment_status === "refunded"
                ? "Refund in progress"
                : "Awaiting payment"}
        </span>
      </div>
    </div>
  );
}

const STORE_STATUS_LABELS: Record<string, string> = {
  pending: "Awaiting payment",
  paid: "Placed",
  placed: "Waiting for shop",
  accepted: "Finding Expert",
  expert_assigned: "Expert assigned",
  ready: "Packed · ready for pickup",
  picked_up: "On the way",
  delivered: "Delivered",
  needs_attention: "Delayed",
  rejected: "Rejected · refund",
  cancelled: "Cancelled · refund",
};

function StoreDeliveryCode({ orderId }: { orderId: string }) {
  const t = useT();
  const { data: otp } = useQuery({
    queryKey: ["store-delivery-otp", orderId],
    queryFn: () => fetchStoreDeliveryOtp(orderId),
    refetchInterval: 30_000,
  });
  if (!otp) return null;
  return (
    <div className="mt-3 rounded-[14px] border border-primary/30 bg-card p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {t("store.deliveryCode")}
      </p>
      <p className="mt-1 text-2xl font-extrabold tracking-[0.3em] text-primary">{otp}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{t("store.deliveryCodeHint")}</p>
    </div>
  );
}

export function OrdersScreen({
  onOpenHome,
  onOpenRewards,
  onOpenBooking,
  onOpenCourier,
  onOpenCourierOrder,
  onOpenContactParcels,
  onOpenStoreOrder,
}: {
  onOpenHome: () => void;
  onOpenRewards: () => void;
  onOpenBooking: (b: BookingRow) => void;
  onOpenCourier?: () => void;
  onOpenCourierOrder?: (orderId: string) => void;
  onOpenContactParcels?: (stopId?: string) => void;
  onOpenStoreOrder?: (orderId: string) => void;
}) {
  const t = useT();
  const { data: courierEnabled = false } = useQuery({
    queryKey: ["courier_enabled"],
    queryFn: () => fetchCourierEnabled(),
    staleTime: 5 * 60_000,
  });
  const { data: bookings = [], isLoading, error } = useQuery({
    queryKey: ["my-bookings"],
    queryFn: fetchBookings,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const { data: parcels = [], isLoading: parcelsLoading } = useQuery({
    queryKey: ["my-courier-orders"],
    queryFn: fetchMyCourierOrders,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const parcelIds = parcels.map((p) => p.id);
  const { data: pendingReturnIds = [] } = useQuery({
    queryKey: ["courier-pending-returns", parcelIds.join(",")],
    queryFn: () => fetchPendingReturnOrderIds(parcelIds),
    enabled: parcelIds.length > 0,
    refetchInterval: 30_000,
  });
  const { data: storeOrders = [], isLoading: storeLoading } = useQuery({
    queryKey: ["my-store-orders"],
    queryFn: fetchMyStoreOrders,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
  useBookingsLive();


  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["my-bookings"] }),
      queryClient.refetchQueries({ queryKey: ["my-courier-orders"] }),
      queryClient.refetchQueries({ queryKey: ["my-store-orders"] }),
    ]);
  });

  const byNewest = (a: OrderItem, b: OrderItem) =>
    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();

  // Parcels that were never paid for are abandoned drafts — hide them.
  const visibleParcels = parcels.filter(
    (p) => p.payment_status === "paid" || p.status !== "REQUESTED",
  );

  const active: OrderItem[] = [
    ...bookings
      .filter((b) => ACTIVE_TRACKING_STATUSES.includes(b.status))
      .map((b) => ({ kind: "booking" as const, id: b.id, createdAt: b.created_at, booking: b })),
    ...visibleParcels
      .filter((p) => COURIER_ACTIVE_STATUSES.includes(p.status))
      .map((p) => ({ kind: "parcel" as const, id: p.id, createdAt: p.created_at, parcel: p })),
    ...storeOrders
      .filter(isStoreOrderActive)
      .map((o) => ({ kind: "store" as const, id: o.id, createdAt: o.created_at, order: o })),
  ].sort(byNewest);

  const past: OrderItem[] = [
    ...bookings
      .filter((b) => PAST_STATUSES.includes(b.status))
      .map((b) => ({ kind: "booking" as const, id: b.id, createdAt: b.created_at, booking: b })),
    ...visibleParcels
      .filter((p) => !COURIER_ACTIVE_STATUSES.includes(p.status))
      .map((p) => ({ kind: "parcel" as const, id: p.id, createdAt: p.created_at, parcel: p })),
    ...storeOrders
      .filter((o) => !isStoreOrderActive(o))
      .map((o) => ({ kind: "store" as const, id: o.id, createdAt: o.created_at, order: o })),
  ].sort(byNewest);

  const openParcel = (p: CourierOrder) => onOpenCourierOrder?.(p.id);

  return (
    <main className="min-h-screen w-full bg-background pb-28 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <h1 className="text-lg font-bold text-foreground">Your Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your active orders and view past ones.
        </p>
        {onOpenContactParcels && <ContactParcelsCard onOpen={onOpenContactParcels} />}

        {/* Active orders */}
        {active.length > 0 && (
          <section className="mt-5 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-primary/80">
              Active
            </h2>
            {active.map((item) =>
              item.kind === "store" ? (
                <StoreOrderCard key={item.id} order={item.order} active onOpen={() => onOpenStoreOrder?.(item.order.id)} />
              ) : item.kind === "booking" ? (
                <div
                  key={item.id}
                  className="rounded-[20px] border-2 border-primary/40 bg-primary/5 p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-bold text-foreground">
                        {item.booking.service_label}
                      </h3>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDate(item.booking)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(
                        item.booking.status,
                      )}`}
                    >
                      {statusLabel(item.booking.status)}
                    </span>
                  </div>
                  {item.booking.addresses && (
                    <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="line-clamp-1">
                        {item.booking.addresses.label
                          ? `${item.booking.addresses.label} · `
                          : ""}
                        {item.booking.addresses.full_address}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => onOpenBooking(item.booking)}
                    className="mt-4 w-full rounded-[14px] bg-primary py-3 text-sm font-bold text-primary-foreground shadow-sm transition active:scale-[0.99]"
                  >
                    Track order
                  </button>
                </div>
              ) : (
                <div
                  key={item.id}
                  className="rounded-[20px] border-2 border-primary/40 bg-primary/5 p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 truncate text-base font-bold text-foreground">
                        <Package className="h-4 w-4 shrink-0 text-primary" />
                        {t("nav.parcel")}
                      </h3>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatStamp(item.parcel.created_at)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(
                        item.parcel.status,
                      )}`}
                    >
                      {statusLabel(item.parcel.status)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="line-clamp-2">
                      {item.parcel.pickup_address} → {item.parcel.drop_address}
                    </span>
                  </div>
                    <ParcelChips parcel={item.parcel} returnPending={pendingReturnIds.includes(item.parcel.id)} />
                  <button
                    onClick={() => openParcel(item.parcel)}
                    className="mt-4 w-full rounded-[14px] bg-primary py-3 text-sm font-bold text-primary-foreground shadow-sm transition active:scale-[0.99]"
                  >
                    {t("courier.trackParcel")}
                  </button>
                </div>
              ),
            )}
          </section>
        )}

        {/* Past orders */}
        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Past Orders
          </h2>
          {isLoading || parcelsLoading || storeLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-destructive">
              Could not load orders.
            </p>
          ) : past.length === 0 && active.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-border bg-card px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <CalendarCheck className="h-7 w-7 text-primary" />
              </div>
              <p className="mt-4 text-base font-bold text-foreground">No orders yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your bookings and parcels will appear here.
              </p>
              <button
                onClick={onOpenHome}
                className="mt-5 rounded-[14px] bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm"
              >
                Book your first cleaning
              </button>
            </div>
          ) : past.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No past orders yet.
            </p>
          ) : (
            past.map((item) =>
              item.kind === "store" ? (
                <StoreOrderCard key={item.id} order={item.order} active={false} onOpen={() => onOpenStoreOrder?.(item.order.id)} />
              ) : item.kind === "booking" ? (
                <button
                  key={item.id}
                  onClick={() => onOpenBooking(item.booking)}
                  className="w-full rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-bold text-foreground">
                        {item.booking.service_label}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(item.booking)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(
                        item.booking.status,
                      )}`}
                    >
                      {statusLabel(item.booking.status)}
                    </span>
                  </div>
                  {item.booking.addresses && (
                    <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="line-clamp-1">
                        {item.booking.addresses.label
                          ? `${item.booking.addresses.label} · `
                          : ""}
                        {item.booking.addresses.full_address}
                      </span>
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-primary">
                      Rs{" "}
                      {item.booking.total_amount && Number(item.booking.total_amount) > 0
                        ? Number(item.booking.total_amount)
                        : item.booking.price}
                    </span>
                    <span className="text-xs font-semibold text-primary">View details →</span>
                  </div>
                </button>
              ) : (
                <button
                  key={item.id}
                  onClick={() => openParcel(item.parcel)}
                  className="w-full rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 truncate text-base font-bold text-foreground">
                        <Package className="h-4 w-4 shrink-0 text-primary" />
                        {t("nav.parcel")}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatStamp(item.parcel.created_at)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(
                        item.parcel.status,
                      )}`}
                    >
                      {statusLabel(item.parcel.status)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="line-clamp-2">
                      {item.parcel.pickup_address} → {item.parcel.drop_address}
                    </span>
                  </div>
                  <ParcelChips parcel={item.parcel} returnPending={pendingReturnIds.includes(item.parcel.id)} />
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-primary">
                      Rs {Number(item.parcel.total_amount ?? 0)}
                    </span>
                    <span className="text-xs font-semibold text-primary">View details →</span>
                  </div>
                </button>
              ),
            )
          )}
        </section>
      </div>

      <BottomNav
        activeKey="orders"
        onHome={onOpenHome}
        onOrders={() => {}}
        onRewards={onOpenRewards}
        onParcel={onOpenCourier}
        showParcel={courierEnabled}
      />
    </main>
  );
}

function ParcelChips({ parcel, returnPending }: { parcel: CourierOrder; returnPending: boolean }) {
  const t = useT();
  const p = Number(parcel.pickup_count ?? 1);
  const d = Number(parcel.drop_count ?? 1);
  const multi = p > 1 || d > 1;
  if (!multi && !returnPending) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {multi && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
          {p === 1 ? t("courier.pickupCount", { count: p }) : t("courier.pickupsCount", { count: p })} · {d === 1 ? t("courier.dropCount", { count: d }) : t("courier.dropsCount", { count: d })}
        </span>
      )}
      {returnPending && (
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning">
          {t("courier.returnPaymentPending")}
        </span>
      )}
    </div>
  );
}
