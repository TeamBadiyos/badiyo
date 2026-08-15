import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { CalendarCheck, MapPin, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "./BottomNav";
import {
  ACTIVE_TRACKING_STATUSES,
  PAST_STATUSES,
  type BookingRow,
} from "./MyBookingsScreen";

async function fetchBookings(): Promise<BookingRow[]> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, service_label, service_duration_minutes, price, status, slot_type, scheduled_date, scheduled_time_slot, created_at, rating, review_text, address_id, razorpay_payment_id, addresses(label, full_address, area, city, latitude, longitude, is_default)",
    )
    .eq("user_id", uid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookingRow[];
}

function statusPill(status: string): string {
  if (status === "completed") return "bg-primary/15 text-primary";
  if (status === "cancelled" || status === "rejected") return "bg-muted text-muted-foreground";
  return "bg-blue-100 text-blue-700";
}

function statusLabel(status: string): string {
  return status.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
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

export function OrdersScreen({
  onOpenHome,
  onOpenRewards,
  onOpenBooking,
}: {
  onOpenHome: () => void;
  onOpenRewards: () => void;
  onOpenBooking: (b: BookingRow) => void;
}) {
  const { data: bookings = [], isLoading, error } = useQuery({
    queryKey: ["my-bookings"],
    queryFn: fetchBookings,
  });

  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await queryClient.refetchQueries({ queryKey: ["my-bookings"] });
  });

  const active = bookings.filter((b) => ACTIVE_TRACKING_STATUSES.includes(b.status));
  const past = bookings.filter((b) => PAST_STATUSES.includes(b.status));

  return (
    <main className="min-h-screen w-full bg-background pb-28 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <h1 className="text-lg font-bold text-foreground">Your Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your active booking and view past cleanings.
        </p>

        {/* Active booking(s) */}
        {active.length > 0 && (
          <section className="mt-5 space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-primary/80">
              Active
            </h2>
            {active.map((b) => (
              <div
                key={b.id}
                className="rounded-[20px] border-2 border-primary/40 bg-primary/5 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-foreground">
                      {b.service_label}
                    </h3>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDate(b)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(
                      b.status,
                    )}`}
                  >
                    {statusLabel(b.status)}
                  </span>
                </div>
                {b.addresses && (
                  <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="line-clamp-1">
                      {b.addresses.label ? `${b.addresses.label} · ` : ""}
                      {b.addresses.full_address}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => onOpenBooking(b)}
                  className="mt-4 w-full rounded-[14px] bg-primary py-3 text-sm font-bold text-primary-foreground shadow-sm transition active:scale-[0.99]"
                >
                  Track order
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Past orders */}
        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Past Orders
          </h2>
          {isLoading ? (
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
                Your cleaning bookings will appear here.
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
            past.map((b) => (
              <button
                key={b.id}
                onClick={() => onOpenBooking(b)}
                className="w-full rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold text-foreground">
                      {b.service_label}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(b)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(
                      b.status,
                    )}`}
                  >
                    {statusLabel(b.status)}
                  </span>
                </div>
                {b.addresses && (
                  <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="line-clamp-1">
                      {b.addresses.label ? `${b.addresses.label} · ` : ""}
                      {b.addresses.full_address}
                    </span>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-bold text-primary">Rs {b.price}</span>
                  <span className="text-xs font-semibold text-primary">View details →</span>
                </div>
              </button>
            ))
          )}
        </section>
      </div>

      <BottomNav
        activeKey="orders"
        onHome={onOpenHome}
        onOrders={() => {}}
        onRewards={onOpenRewards}
      />
    </main>
  );
}
