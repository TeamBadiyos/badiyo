import { fetchBookingOtps } from "@/lib/bookingOtp";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { useT } from "@/i18n";

type Kind = "start" | "end";

/**
 * Displays the real 4-digit OTP for the customer to share aloud with the expert.
 * The customer cannot self-verify. When the expert enters the code on their side
 * (Command Center for now), the booking status advances and realtime triggers
 * onVerified() to move to the next screen.
 */
export function OtpScreen({
  bookingId,
  kind,
  onVerified,
}: {
  bookingId: string | null;
  kind: Kind;
  onVerified: () => void;
}) {
  const t = useT();
  const title = kind === "start" ? t("otp.startTitle") : t("otp.endTitle");
  const subtitle = kind === "start" ? t("otp.startSub") : t("otp.endSub");
  const targetStatus = kind === "start" ? "in_progress" : "completed";

  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const advancedRef = useRef(false);

  // Load / generate the OTP for this booking.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    (async () => {
      try {
        const o = await fetchBookingOtps(bookingId);
        const c = kind === "start" ? o.start_otp : o.end_otp;
        if (!c) throw new Error("OTP load nahi hua");
        if (!cancelled) setCode(c);
      } catch (e) {
        if (!cancelled) setError(await getErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, kind, attempt]);

  // Realtime: advance when the expert verifies (status flips server-side).
  useEffect(() => {
    if (!bookingId) return;

    const advanceIfMatch = (row: { status?: string | null } | null) => {
      if (!row || advancedRef.current) return;
      if (row.status === targetStatus) {
        advancedRef.current = true;
        onVerified();
      }
    };

    const channel = supabase
      .channel(`booking-otp-${bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        (payload) => advanceIfMatch(payload.new as { status?: string | null }),
      )
      .subscribe();

    // Safety net: if the socket drops (backgrounded app, flaky network) poll
    // the booking so verification still advances within a couple of seconds.
    const poll = setInterval(async () => {
      if (advancedRef.current) return;
      const { data } = await supabase
        .from("bookings")
        .select("status")
        .eq("id", bookingId)
        .maybeSingle();
      advanceIfMatch(data as { status?: string | null } | null);
    }, 4000);

    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [bookingId, targetStatus, onVerified]);

  return (
    <main className="min-h-screen w-full bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pt-16">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="mt-6 text-xl font-bold text-foreground">{title}</h1>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <div className="mt-10 flex min-h-[80px] justify-center gap-3">
          {code
            ? code.split("").map((digit, i) => (
                <div
                  key={i}
                  className="flex h-16 w-14 items-center justify-center rounded-[14px] border-2 border-primary/30 bg-card text-3xl font-bold text-foreground"
                >
                  {digit}
                </div>
              ))
            : !error && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating code…
                </div>
              )}
        </div>

        {error && (
          <div className="mt-4 text-center">
            <p className="text-sm font-semibold text-foreground">OTP load nahi hua</p>
            <button
              type="button"
              onClick={() => { setError(null); setAttempt((n) => n + 1); }}
              className="mt-2 rounded-full bg-primary px-5 py-2 text-xs font-bold text-primary-foreground"
            >
              Retry
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Do not share this code with anyone except your expert
        </p>

        <div className="mt-auto pb-8 pt-10">
          <div className="flex items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Waiting for your expert to enter the code…
          </div>
        </div>
      </div>
    </main>
  );
}
