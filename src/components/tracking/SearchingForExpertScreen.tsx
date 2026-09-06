import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Search, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SelectedAddress } from "../BookingSummaryScreen";
import type { SelectedService, SelectedSlot } from "../SlotSelectionScreen";
import { StageTracker, stageFromStatus } from "./StageTracker";
import { CancelBookingButton } from "./CancelBookingButton";
import { useT } from "@/i18n";


type BookingRow = {
  status: string;
  assigned_expert_id: string | null;
  deleted_at: string | null;
};

async function fetchBookingRow(bookingId: string): Promise<BookingRow | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select("status, assigned_expert_id, deleted_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) {
    console.error("fetchBookingRow (searching) failed:", error);
    return null;
  }
  return (data as unknown as BookingRow | null) ?? null;
}

export function SearchingForExpertScreen({
  bookingId,
  address,
  service,
  slot,
  currentStatus,
  onExpertAssigned,
  onCancelled,
}: {
  bookingId: string | null;
  address: SelectedAddress;
  service?: SelectedService | null;
  slot?: SelectedSlot | null;
  currentStatus?: string;
  onExpertAssigned: () => void;
  onCancelled?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const queryKey = ["searching-booking", bookingId] as const;

  const { data: booking, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchBookingRow(bookingId!),
    enabled: !!bookingId,
    initialData: currentStatus
      ? ({
          status: currentStatus,
          assigned_expert_id: null,
          deleted_at: null,
        } as BookingRow)
      : undefined,
    // Realtime is the fast path; this short poll is the safety net so a
    // dropped/failed socket can never leave the screen stale.
    staleTime: 0,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const advancedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!bookingId) return;
    const channel = supabase
      .channel(`booking-search-${bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        (payload) => {
          const row = payload.new as Partial<BookingRow>;
          qc.setQueryData<BookingRow | undefined>(queryKey, (prev) =>
            prev ? { ...prev, ...row } : (row as BookingRow),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        () => {
          if (cancelledRef.current) return;
          cancelledRef.current = true;
          onCancelled?.();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, qc, queryKey, refetch, onCancelled]);

  useEffect(() => {
    if (!booking) return;
    const isCancelled =
      booking.status === "cancelled" ||
      booking.status === "rejected" ||
      !!booking.deleted_at;
    if (isCancelled && !cancelledRef.current) {
      cancelledRef.current = true;
      onCancelled?.();
      return;
    }
    if (advancedRef.current) return;
    // Move on the moment an expert is assigned OR status crosses ahead.
    if (
      booking.assigned_expert_id ||
      booking.status === "expert_assigned" ||
      booking.status === "in_progress" ||
      booking.status === "completed"
    ) {
      advancedRef.current = true;
      onExpertAssigned();
    }
  }, [booking, onExpertAssigned, onCancelled]);

  const status = booking?.status ?? currentStatus ?? "accepted";

  return (
    <main className="min-h-screen w-full bg-background pb-8">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <h1 className="text-lg font-bold text-foreground">{t("track.findingExpert")}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("track.bookingNo", { id: bookingId?.slice(0, 8) ?? "—" })}
        </p>

        <div className="mt-5">
          <StageTracker stage={stageFromStatus(status)} />
        </div>

        {/* Radiating search indicator */}
        <section className="mt-6 rounded-[20px] border border-border bg-card p-6">
          <div className="flex flex-col items-center text-center">
            <div className="relative flex h-32 w-32 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/20" />
              <span
                className="absolute inline-flex h-24 w-24 animate-ping rounded-full bg-primary/30"
                style={{ animationDelay: "0.4s" }}
              />
              <span className="absolute inline-flex h-16 w-16 rounded-full bg-primary/15" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg">
                <Search className="h-6 w-6 text-primary-foreground" />
              </div>
            </div>
            <h2 className="mt-5 text-base font-bold text-foreground">
              {t("track.searchingTitle")}
            </h2>
            <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t("track.searchingSub")}
            </p>
          </div>
        </section>

        {/* Booking summary */}
        <section className="mt-5 rounded-[18px] border border-border bg-card p-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("track.summary")}
          </div>
          {service && (
            <div className="mt-2 flex items-start justify-between gap-3">
              <div className="text-sm font-bold text-foreground">
                {service.duration_label}
                {service.subtitle ? ` · ${service.subtitle}` : ""}
              </div>
              <div className="text-sm font-bold text-primary">{t("common.rupees", { amount: service.price })}</div>
            </div>
          )}
          {slot && (
            <div className="mt-1 text-xs text-muted-foreground">
              {slot.mode === "now"
                ? t("track.asap")
                : `${slot.day} · ${slot.slotLabel} (${slot.slotRange})`}
            </div>
          )}
          <div className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="line-clamp-2">
              {address.label ? `${address.label} · ` : ""}
              {address.full_address}
            </span>
          </div>
        </section>

        <CancelBookingButton
          bookingId={bookingId}
          stage="searching"
          price={service?.price ?? null}
          onCancelled={onCancelled}
        />

      </div>
    </main>
  );
}
