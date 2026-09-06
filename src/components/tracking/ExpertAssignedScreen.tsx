import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, User, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SelectedAddress } from "../BookingSummaryScreen";
import { StageTracker, stageFromStatus } from "./StageTracker";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { ServiceLocationMap } from "./ServiceLocationMap";
import { CancelBookingButton } from "./CancelBookingButton";
import { useT } from "@/i18n";


type ExpertInfo = {
  id: string;
  name: string;
  phone: string | null;
  photo_url: string | null;
} | null;

type BookingRow = {
  status: string;
  assigned_expert_id: string | null;
  start_otp: string | null;
  deleted_at: string | null;
  price: number | null;
  experts: ExpertInfo;
};

async function fetchBookingRow(bookingId: string): Promise<BookingRow | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "status, assigned_expert_id, start_otp, deleted_at, price, experts:assigned_expert_id ( id, name, phone, photo_url )",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) {
    console.error("fetchBookingRow failed:", error);
    return null;
  }
  return (data as unknown as BookingRow | null) ?? null;
}


export function ExpertAssignedScreen({
  bookingId,
  address,
  currentStatus,
  onShowStartOtp,
  onAdvanceInProgress,
  onAdvanceCompleted,
  onCancelled,
}: {
  bookingId: string | null;
  address: SelectedAddress;
  currentStatus?: string;
  onShowStartOtp?: () => void;
  onAdvanceInProgress?: () => void;
  onAdvanceCompleted?: () => void;
  onCancelled?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const queryKey = ["tracking-booking", bookingId] as const;

  const { data: booking, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchBookingRow(bookingId!),
    enabled: !!bookingId,
    initialData: currentStatus
      ? ({
          status: currentStatus,
          assigned_expert_id: null,
          start_otp: null,
          deleted_at: null,
          price: null,
          experts: null,
        } as BookingRow)
      : undefined,

    staleTime: 0,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const status = booking?.status ?? currentStatus ?? "confirmed";
  const expert = booking?.experts ?? null;

  // When status reaches expert_assigned and no otp yet, ensure one exists so the customer
  // can already read it aloud without tapping anything.
  useEffect(() => {
    if (!bookingId) return;
    if (status !== "expert_assigned") return;
    if (booking?.start_otp) return;
    supabase.rpc("ensure_start_otp", { _booking_id: bookingId }).then(({ data, error }) => {
      if (error) {
        console.error("ensure_start_otp failed:", error);
        return;
      }
      const code = (data as string | null) ?? null;
      if (!code) return;
      qc.setQueryData<BookingRow | undefined>(queryKey, (prev) =>
        prev ? { ...prev, start_otp: code } : prev,
      );
    });
  }, [bookingId, status, booking?.start_otp, qc, queryKey]);

  // Realtime: react instantly to status/soft-delete changes on this booking.
  const advancedRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (!bookingId) return;
    const channel = supabase
      .channel(`booking-track-${bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        (payload) => {
          const row = payload.new as Partial<BookingRow> & { status?: string };
          qc.setQueryData<BookingRow | undefined>(queryKey, (prev) =>
            prev ? { ...prev, ...row } : (row as BookingRow),
          );
          // Refetch to hydrate the joined expert row when assignment changes.
          if (row.assigned_expert_id !== undefined) {
            refetch();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        () => {
          if (cancelledRef.current) return;
          cancelledRef.current = true;
          qc.setQueryData<BookingRow | undefined>(queryKey, (prev) =>
            prev ? { ...prev, status: "cancelled" } : prev,
          );
          onCancelled?.();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, qc, queryKey, refetch, onCancelled]);

  // Advance UI when status crosses ahead of this screen, or exit on cancel/soft-delete.
  useEffect(() => {
    if (!status) return;
    const isCancelled =
      status === "cancelled" || status === "rejected" || !!booking?.deleted_at;
    if (isCancelled && !cancelledRef.current && onCancelled) {
      cancelledRef.current = true;
      onCancelled();
      return;
    }
    if (advancedRef.current === status) return;
    if (status === "in_progress" && onAdvanceInProgress) {
      advancedRef.current = status;
      onAdvanceInProgress();
    } else if (status === "completed" && onAdvanceCompleted) {
      advancedRef.current = status;
      onAdvanceCompleted();
    }
  }, [status, booking?.deleted_at, onAdvanceInProgress, onAdvanceCompleted, onCancelled]);


  const { pull, refreshing } = usePullToRefresh(async () => {
    await refetch();
  });

  // map rendering moved to <ServiceLocationMap />


  const showExpert = status === "expert_assigned" || status === "in_progress";
  const isConfirmed = status === "confirmed";
  const isAccepted = status === "accepted";

  const headline = isConfirmed
    ? t("track.findingExpert")
    : isAccepted
      ? t("track.assigningExpert")
      : t("track.assignedTitle");

  return (
    <main className="min-h-screen w-full bg-background pb-8">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <h1 className="text-lg font-bold text-foreground">{headline}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("track.bookingNo", { id: bookingId?.slice(0, 8) ?? "—" })}
        </p>

        {/* Stage progress */}
        <div className="mt-5">
          <StageTracker stage={stageFromStatus(status)} />
        </div>

        {/* Expert card / waiting states */}
        {showExpert ? (
          <section className="mt-5 rounded-[18px] border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                {expert?.photo_url ? (
                  <img
                    src={expert.photo_url}
                    alt={expert.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <User className="h-7 w-7 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-base font-bold text-foreground">
                  {expert?.name ?? t("track.yourExpert")}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t("track.verifiedExpert")}</div>
              </div>
            </div>

            {expert?.phone && (
              <div className="mt-4">
                <a
                  href={`tel:${expert.phone}`}
                  aria-label={t("track.callExpert")}
                  className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-primary px-4 py-3 text-sm font-bold text-primary-foreground active:scale-[0.99]"
                >
                  <Phone className="h-4 w-4" />
                  {t("track.callExpert")}
                </a>
              </div>
            )}

            {/* Start code shown directly — no hidden button */}
            <div className="mt-4 rounded-[14px] border border-primary/30 bg-primary/5 p-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("track.startCode")}
              </div>
              <div className="mt-1 flex items-center justify-center gap-2 font-mono text-3xl font-bold tracking-[0.35em] text-primary">
                {booking?.start_otp ? (
                  booking.start_otp
                ) : (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm font-medium text-muted-foreground">
                      {t("track.preparingCode")}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("track.showToExpert")}
              </p>
              {onShowStartOtp && (
                <button
                  type="button"
                  onClick={onShowStartOtp}
                  className="mt-3 text-xs font-bold text-primary underline"
                >
                  {t("track.openFullScreen")}
                </button>
              )}
            </div>
          </section>
        ) : (
          <section className="mt-5 rounded-[18px] border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <User className="h-7 w-7 text-primary" />
                <Loader2 className="absolute h-14 w-14 animate-spin text-primary/40" />
              </div>
              <div className="flex-1">
                <div className="text-base font-bold text-foreground">
                  {isConfirmed ? t("track.finding") : t("track.assigning")}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {isConfirmed
                    ? t("track.notifyingNearby")
                    : t("track.pickingBest")}
                </div>
              </div>
            </div>
          </section>
        )}

        <ServiceLocationMap address={address} />

        {(status === "expert_assigned" || status === "accepted" || status === "confirmed") && (
          <CancelBookingButton
            bookingId={bookingId}
            stage={status === "expert_assigned" ? "assigned" : "searching"}
            price={booking?.price ?? null}
            onCancelled={onCancelled}
          />
        )}



      </div>
    </main>
  );
}
