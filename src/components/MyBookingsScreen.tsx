import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { ArrowLeft, CalendarCheck, MapPin } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BookingRow = {
  id: string;
  service_label: string;
  service_duration_minutes: number;
  price: number;
  status: string;
  slot_type: string;
  scheduled_date: string | null;
  scheduled_time_slot: string | null;
  created_at: string | null;
  rating: number | null;
  review_text: string | null;
  address_id: string | null;
  razorpay_payment_id: string | null;
  addresses: {
    label: string | null;
    full_address: string;
    area: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    is_default: boolean | null;
  } | null;
};

export const UPCOMING_STATUSES = [
  "confirmed",
  "accepted",
  "expert_assigned",
  "in_progress",
];
export const PAST_STATUSES = ["completed", "cancelled", "rejected"];
export { ACTIVE_TRACKING_STATUSES } from "@/lib/bookingStatus";


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
  if (error) {
    console.error("fetchBookings failed:", error);
    throw error;
  }
  return (data ?? []) as unknown as BookingRow[];
}

function statusPillClasses(status: string): string {
  if (status === "completed") return "bg-primary/15 text-primary";
  if (status === "cancelled") return "bg-muted text-muted-foreground";
  return "bg-blue-100 text-blue-700";
}

function statusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatBookingDate(b: BookingRow): string {
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

export function MyBookingsScreen({
  onBack,
  onOpenBooking,
  onGoHome,
}: {
  onBack: () => void;
  onOpenBooking: (booking: BookingRow) => void;
  onGoHome: () => void;
}) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const { data: bookings = [], isLoading, error } = useQuery({
    queryKey: ["my-bookings"],
    queryFn: fetchBookings,
  });

  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await queryClient.refetchQueries({ queryKey: ["my-bookings"] });
  });

  const filtered = bookings.filter((b) =>
    tab === "upcoming"
      ? UPCOMING_STATUSES.includes(b.status)
      : PAST_STATUSES.includes(b.status),
  );

  return (
    <main className="min-h-screen w-full bg-background pb-10 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">My Bookings</h1>
        </header>

        {/* Tabs */}
        <div className="mt-5 flex rounded-[14px] bg-muted p-1">
          {(["upcoming", "past"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-[10px] py-2 text-sm font-semibold transition ${
                tab === t
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {t === "upcoming" ? "Upcoming" : "Past"}
            </button>
          ))}
        </div>

        {/* List */}
        <section className="mt-5 space-y-3">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-destructive">
              Could not load bookings. Pull to refresh or try again.
            </p>
          ) : filtered.length === 0 ? (
            <EmptyState onGoHome={onGoHome} />
          ) : (
            filtered.map((b) => (
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
                      {formatBookingDate(b)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPillClasses(
                      b.status,
                    )}`}
                  >
                    {statusLabel(b.status)}
                  </span>
                </div>
                {b.addresses ? (
                  <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="line-clamp-1">
                      {b.addresses.label ? `${b.addresses.label} · ` : ""}
                      {b.addresses.full_address}
                    </span>
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm font-bold text-primary">Rs {b.price}</span>
                  <span className="text-xs font-semibold text-primary">View details →</span>
                </div>
              </button>
            ))
          )}
        </section>
      </div>
    </main>
  );
}

function EmptyState({ onGoHome }: { onGoHome: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <CalendarCheck className="h-7 w-7 text-primary" />
      </div>
      <p className="mt-4 text-base font-bold text-foreground">No bookings yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Your cleaning bookings will appear here.
      </p>
      <button
        onClick={onGoHome}
        className="mt-5 rounded-[14px] bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-sm"
      >
        Book your first cleaning
      </button>
    </div>
  );
}
