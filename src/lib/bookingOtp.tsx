import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Loader2, MessageCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Statuses where a customer-facing OTP exists. */
export const OTP_STATUSES = ["expert_assigned", "on_the_way", "arrived", "in_progress"];

export type BookingOtps = { status: string; start_otp: string | null; end_otp: string | null };

export const bookingOtpKey = (id: string | null) => ["booking-otps", id] as const;

/** The ONLY way the app reads a booking OTP (server checks the caller owns the booking). */
export async function fetchBookingOtps(bookingId: string): Promise<BookingOtps> {
  const { data, error } = await supabase.rpc("get_my_booking_otps" as never, { _booking_id: bookingId } as never);
  if (error) throw error;
  const d = (data ?? {}) as Partial<BookingOtps>;
  return { status: d.status ?? "", start_otp: d.start_otp ?? null, end_otp: d.end_otp ?? null };
}

/** status is used only as a refetch trigger so the code flips Start → End instantly. */
export function useBookingOtps(bookingId: string | null, status?: string | null) {
  const enabled = !!bookingId && (status == null || OTP_STATUSES.includes(status));
  const q = useQuery({
    queryKey: bookingOtpKey(bookingId),
    queryFn: () => fetchBookingOtps(bookingId!),
    enabled,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 3,
  });
  // Keep the old code on screen and refresh quietly when the stage changes.
  const { refetch } = q;
  useEffect(() => {
    if (enabled) void refetch();
  }, [status, enabled, refetch]);
  return q;
}

/** Which code to show right now (Start before service begins, End while it runs). */
export function currentOtp(o: BookingOtps | undefined | null): { kind: "start" | "end"; code: string } | null {
  if (!o) return null;
  if (o.status === "in_progress" && o.end_otp) return { kind: "end", code: o.end_otp };
  if (["expert_assigned", "on_the_way", "arrived"].includes(o.status) && o.start_otp)
    return { kind: "start", code: o.start_otp };
  return null;
}

export async function copyOtp(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    toast.success("OTP copied");
  } catch {
    toast(code);
  }
}

/** Big OTP block with copy + retry. Never renders an endless spinner. */
export function BookingOtpCard({
  bookingId,
  status,
  compact = false,
  whatsappShareDetails,
}: {
  bookingId: string | null;
  status?: string | null;
  compact?: boolean;
  whatsappShareDetails?: { expertName?: string; durationMinutes?: number; startTime?: string; endTime?: string };
}) {
  const q = useBookingOtps(bookingId, status);
  if (!bookingId || (status && !OTP_STATUSES.includes(status))) return null;

  const wrap = `rounded-[14px] border border-primary/30 bg-primary/5 text-center ${compact ? "p-3" : "p-4"}`;

  if (q.isError) {
    return (
      <div className={wrap} onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-foreground">OTP load nahi hua</p>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void q.refetch(); }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground"
        >
          <RotateCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    );
  }

  const cur = currentOtp(q.data);
  if (!cur) {
    // Loaded but no code for this stage (e.g. completed) → hide; still loading → short loader.
    if (!q.isLoading && !q.isFetching) return null;
    return (
      <div className={wrap}>
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> OTP load ho raha hai…
        </span>
      </div>
    );
  }

  return (
    <div className={wrap} onClick={(e) => e.stopPropagation()}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {cur.kind === "start" ? "Start OTP" : "End OTP"}
      </div>
      <div className="mt-1 flex items-center justify-center gap-3">
        <span className={`font-mono font-extrabold tracking-[0.3em] text-primary ${compact ? "text-2xl" : "text-4xl"}`}>
          {cur.code}
        </span>
        <button
          type="button"
          aria-label="Copy OTP"
          onClick={(e) => { e.stopPropagation(); void copyOtp(cur.code); }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
        >
          <Copy className="h-4 w-4 text-foreground" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {cur.kind === "start" ? "Expert ko kaam shuru karne ke liye batayein" : "Kaam khatam hone par expert ko batayein"}
      </p>
      {whatsappShareDetails && cur.kind === "end" && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs text-muted-foreground">Booked for someone else?</span>
          <Button asChild size="sm" variant="outline">
            <a
              href={`https://wa.me/?text=${encodeURIComponent([
                "badiyos — Check-out OTP",
                `Expert: ${whatsappShareDetails.expertName ?? "Your expert"}`,
                whatsappShareDetails.durationMinutes ? `Duration: ${whatsappShareDetails.durationMinutes} minutes` : null,
                whatsappShareDetails.startTime ? `Started at: ${whatsappShareDetails.startTime}` : null,
                whatsappShareDetails.endTime ? `Ends at: ${whatsappShareDetails.endTime}` : null,
                `End OTP: *${cur.code}*`,
                "Share this code with the expert only after the service is finished.",
              ].filter(Boolean).join("\n"))}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share OTP on WhatsApp"
            >
              <MessageCircle /> Share OTP
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}

/** Customer's newest booking that currently has an OTP (assigned → in progress). */
export function useOtpActiveBooking(enabled = true) {
  return useQuery({
    queryKey: ["otp-active-booking"],
    enabled,
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getSession();
      const uid = u.session?.user.id;
      if (!uid) return null;
      const { data, error } = await supabase
        .from("bookings")
        .select("id, status, service_label")
        .eq("user_id", uid)
        .in("status", OTP_STATUSES)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string; status: string; service_label: string | null } | null) ?? null;
    },
  });
}

export function openBookingScreen(bookingId: string) {
  window.dispatchEvent(new CustomEvent("badiyos:open-booking", { detail: bookingId }));
}

/** Home (Clean tab) card for the live booking, with the big OTP. */
export function ActiveBookingHomeCard() {
  const { data: b } = useOtpActiveBooking();
  if (!b) return null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openBookingScreen(b.id)}
      className="mt-4 rounded-[20px] border-2 border-primary/40 bg-primary/5 p-4 text-left shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-bold text-foreground">{b.service_label ?? "Your booking"}</span>
        <span className="shrink-0 text-xs font-bold text-primary">Track →</span>
      </div>
      <div className="mt-3">
        <BookingOtpCard bookingId={b.id} status={b.status} compact />
      </div>
    </div>
  );
}

/** One-line OTP text for the sticky strip. */
export function OtpInline({ bookingId, status }: { bookingId: string; status: string }) {
  const q = useBookingOtps(bookingId, status);
  if (q.isError) return <>OTP load nahi hua · tap to retry</>;
  const cur = currentOtp(q.data);
  if (!cur) return <>OTP load ho raha hai…</>;
  return <>{cur.kind === "start" ? "Start OTP" : "End OTP"} <b className="tracking-[0.2em]">{cur.code}</b></>;
}
