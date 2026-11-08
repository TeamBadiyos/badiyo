import { useQuery } from "@tanstack/react-query";
import { Copy, Loader2, RotateCw } from "lucide-react";
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
  return useQuery({
    queryKey: [...bookingOtpKey(bookingId), status ?? null],
    queryFn: () => fetchBookingOtps(bookingId!),
    enabled,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 2,
  });
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
}: {
  bookingId: string | null;
  status?: string | null;
  compact?: boolean;
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
    </div>
  );
}
