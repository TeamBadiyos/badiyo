import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  X,
  Loader2,
  ArrowLeft,
  RefreshCw,
  Phone,
  User,
  Star,
  MapPin,
  CalendarClock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n";
import { getErrorMessage } from "@/lib/errorMessage";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { fetchSections } from "@/lib/homeData";
import { hapticImpact } from "@/lib/haptics";
import { TimerRing } from "./TimerRing";
import {
  ACTIVE_BOOKING_KEY,
  formatClock,
  formatDayTime,
  formatRemaining,
  toneForRemaining,
  TONE_HEX,
  TONE_TEXT,
  useNow,
} from "@/lib/liveService";
import type { SelectedAddress } from "../BookingSummaryScreen";

type BookingTiming = {
  id: string;
  status: string;
  service_duration_minutes: number;
  service_end_at: string | null;
  started_at: string | null;
  end_otp: string | null;
  deleted_at: string | null;
};

type ExpertProfile = {
  id: string;
  name: string;
  phone: string | null;
  photo_url: string | null;
  avg_rating: number | null;
  review_count: number | null;
};

type CatalogueItem = {
  id: string;
  duration_minutes: number;
  duration_label: string;
  price: number;
};

const TIP_AMOUNTS = [25, 50, 100];

const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";
function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const existing = document.querySelector(
      `script[src="${RAZORPAY_SRC}"]`,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const s = document.createElement("script");
    s.src = RAZORPAY_SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function beep(kind: "warning" | "end") {
  try {
    const AC =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };
    if (kind === "warning") {
      play(880, 0, 0.25);
      play(880, 0.3, 0.25);
    } else {
      play(660, 0, 0.35);
      play(520, 0.4, 0.35);
      play(400, 0.85, 0.5);
    }
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    // best-effort
  }
}

async function fetchBookingTiming(id: string): Promise<BookingTiming | null> {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, status, service_duration_minutes, service_end_at, started_at, end_otp, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("fetchBookingTiming failed:", error);
    return null;
  }
  return (data as BookingTiming | null) ?? null;
}

async function fetchExpertProfile(bookingId: string): Promise<ExpertProfile | null> {
  const { data, error } = await supabase.rpc("get_assigned_expert_profile", {
    _booking_id: bookingId,
  });
  if (error) {
    console.error("get_assigned_expert_profile failed:", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ExpertProfile | undefined) ?? null;
}

async function fetchExtensionOptions(): Promise<CatalogueItem[]> {
  const { data, error } = await supabase
    .from("service_catalogue_config")
    .select("id, duration_minutes, duration_label, price, is_active, display_order")
    .eq("is_active", true)
    .order("duration_minutes", { ascending: true });
  if (error) {
    console.error("fetchExtensionOptions failed:", error);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    duration_minutes: r.duration_minutes as number,
    duration_label: (r.duration_label as string) ?? `${r.duration_minutes} minutes`,
    price: Number(r.price),
  }));
}

export function ServiceInProgressScreen({
  bookingId,
  address,
  onShowEndOtp,
  onAdvanceCompleted,
  onCancelled,
  onBack,
  onReferNow,
}: {
  bookingId: string | null;
  address?: SelectedAddress | null;
  onShowEndOtp?: () => void;
  onAdvanceCompleted?: () => void;
  onCancelled?: () => void;
  onBack?: () => void;
  onReferNow?: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();

  // Start the service (idempotent) as soon as we arrive here.
  useEffect(() => {
    if (!bookingId) return;
    supabase.rpc("start_service", { _booking_id: bookingId }).then(({ error }) => {
      if (error) {
        console.error("start_service failed:", error);
        return;
      }
      qc.invalidateQueries({ queryKey: ["booking-timing", bookingId] });
    });
  }, [bookingId, qc]);

  const { data: timing, refetch: refetchTiming } = useQuery({
    queryKey: ["booking-timing", bookingId],
    queryFn: () => fetchBookingTiming(bookingId!),
    enabled: !!bookingId,
    refetchOnWindowFocus: true,
    staleTime: 0,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
  });

  const { data: expert } = useQuery({
    queryKey: ["booking-expert-profile", bookingId],
    queryFn: () => fetchExpertProfile(bookingId!),
    enabled: !!bookingId,
    staleTime: 60_000,
  });

  const { data: sections = [] } = useQuery({
    queryKey: ["homepage_sections"],
    queryFn: fetchSections,
    staleTime: 5 * 60_000,
  });
  const banner = sections.find((s) => s.section_type === "inprogress_banner")?.payload ?? null;

  // Realtime subscription for instant UI updates + auto-advance / cancel handling.
  const advancedRef = useRef(false);
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (!bookingId) return;
    const channel = supabase
      .channel(`booking-inprog-${bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        (payload) => {
          const row = payload.new as Partial<BookingTiming>;
          qc.setQueryData<BookingTiming | null>(["booking-timing", bookingId], (prev) =>
            prev ? { ...prev, ...row } : (row as BookingTiming),
          );
          const isCancelled =
            row.status === "cancelled" || row.status === "rejected" || !!row.deleted_at;
          if (isCancelled && !cancelledRef.current && onCancelled) {
            cancelledRef.current = true;
            onCancelled();
            return;
          }
          if (row.status === "completed" && !advancedRef.current && onAdvanceCompleted) {
            advancedRef.current = true;
            onAdvanceCompleted();
          }
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
  }, [bookingId, qc, onAdvanceCompleted, onCancelled]);

  const { pull, refreshing } = usePullToRefresh(async () => {
    await refetchTiming();
  });

  const now = useNow(true);

  const endMs = timing?.service_end_at ? Date.parse(timing.service_end_at) : null;
  const startMs = timing?.started_at ? Date.parse(timing.started_at) : null;
  const totalDurationMin = timing?.service_duration_minutes ?? 0;
  const remainingSec =
    endMs != null ? Math.max(0, Math.floor((endMs - now) / 1000)) : totalDurationMin * 60;
  const totalSec = Math.max(1, totalDurationMin * 60);
  const progress = Math.max(0, Math.min(1, remainingSec / totalSec));
  const tone = toneForRemaining(remainingSec);
  const graceOpen = endMs != null && now <= endMs + 10 * 60 * 1000;

  // Sound cues at 5 minutes and at the end.
  const warnedRef = useRef(false);
  const endedRef = useRef(false);
  useEffect(() => {
    if (endMs == null) return;
    if (!warnedRef.current && remainingSec > 0 && remainingSec <= 300) {
      warnedRef.current = true;
      beep("warning");
    }
    if (!endedRef.current && remainingSec === 0) {
      endedRef.current = true;
      beep("end");
    }
  }, [remainingSec, endMs]);

  // Extension sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const { data: extOptions = [] } = useQuery({
    queryKey: ["extension-options"],
    queryFn: fetchExtensionOptions,
    enabled: sheetOpen,
    staleTime: 5 * 60_000,
  });
  const [busyOptionId, setBusyOptionId] = useState<string | null>(null);
  const [extError, setExtError] = useState<string | null>(null);

  async function buyExtension(opt: CatalogueItem) {
    if (!bookingId) return;
    setBusyOptionId(opt.id);
    setExtError(null);
    try {
      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) throw new Error("Failed to load Razorpay Checkout");

      const receipt = `ext_${Date.now()}`;
      const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
        body: {
          service_duration_minutes: opt.duration_minutes,
          currency: "INR",
          receipt,
          purpose: "extension",
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.order_id || !data?.key_id) throw new Error("Invalid order response");

      const { data: userData } = await supabase.auth.getUser();
      const contact = userData.user?.phone || undefined;

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key: data.key_id,
          order_id: data.order_id,
          amount: data.amount,
          currency: data.currency,
          name: "badiyos",
          description: `Extend by ${opt.duration_label}`,
          prefill: { contact },
          theme: { color: "#00B97A" },
          handler: async (resp) => {
            const { data: newEnd, error: extErr } = await supabase.rpc("extend_booking", {
              _booking_id: bookingId,
              _extra_minutes: opt.duration_minutes,
              _razorpay_payment_id: resp.razorpay_payment_id,
            });
            if (extErr) {
              reject(new Error(extErr.message));
              return;
            }
            qc.setQueryData<BookingTiming | null>(["booking-timing", bookingId], (prev) =>
              prev ? { ...prev, service_end_at: (newEnd as string) ?? prev.service_end_at } : prev,
            );
            qc.invalidateQueries({ queryKey: ["booking-timing", bookingId] });
            qc.invalidateQueries({ queryKey: ACTIVE_BOOKING_KEY });
            warnedRef.current = false;
            endedRef.current = false;
            setSheetOpen(false);
            resolve();
          },
          modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
        });
        rzp.open();
      });
    } catch (e) {
      setExtError(await getErrorMessage(e));
    } finally {
      setBusyOptionId(null);
    }
  }

  // Tips
  const [tipBusy, setTipBusy] = useState<number | null>(null);
  const [tipPaid, setTipPaid] = useState<number | null>(null);
  const [tipError, setTipError] = useState<string | null>(null);

  async function payTip(amount: number) {
    if (!bookingId) return;
    setTipBusy(amount);
    setTipError(null);
    try {
      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) throw new Error("Failed to load Razorpay Checkout");
      const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
        body: {
          purpose: "tip",
          tip_amount: amount,
          currency: "INR",
          receipt: `tip_${Date.now()}`,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.order_id || !data?.key_id) throw new Error("Invalid order response");

      const { data: userData } = await supabase.auth.getUser();
      const contact = userData.user?.phone || undefined;

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key: data.key_id,
          order_id: data.order_id,
          amount: data.amount,
          currency: data.currency,
          name: "badiyos",
          description: `Tip for ${expert?.name ?? "your expert"}`,
          prefill: { contact },
          theme: { color: "#00B97A" },
          handler: async (resp) => {
            try {
              // Server verifies the payment with Razorpay before crediting.
              await recordTip({
                data: {
                  booking_id: bookingId,
                  amount,
                  razorpay_payment_id: resp.razorpay_payment_id,
                  razorpay_order_id: data.order_id,
                },
              });
            } catch (e) {
              reject(e instanceof Error ? e : new Error("Could not record your tip"));
              return;
            }
            setTipPaid(amount);
            resolve();
          },

          modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
        });
        rzp.open();
      });
    } catch (e) {
      setTipError(await getErrorMessage(e));
    } finally {
      setTipBusy(null);
    }
  }

  const canExtend = timing?.status === "in_progress" && (remainingSec > 0 || graceOpen);
  const otp = timing?.end_otp ?? null;

  function shareOtpOnWhatsApp() {
    const message = [
      "Hi 👋",
      "",
      "Your service is currently in progress.",
      "",
      `🔹 *Expert Name:* ${expert?.name ?? "Your expert"}`,
      "",
      `🔹 *Duration:* ${totalDurationMin} min`,
      "",
      `🔹 *Started at:* ${formatDayTime(startMs)}`,
      "",
      `⏱️ Your job ends at ${formatDayTime(endMs)}.`,
      "",
      `⏱️ Once done, please share this *Check-Out OTP* to end the service: *${otp ?? "----"}*`,
      "",
      "Thank you for choosing badiyos!",
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  }

  return (
    <main className="min-h-screen w-full bg-background pb-28">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          {onBack ? (
            <button
              onClick={onBack}
              aria-label={t("common.back")}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
            >
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={() => refetchTiming()}
            aria-label="Refresh"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          >
            <RefreshCw className="h-4.5 w-4.5 text-foreground" />
          </button>
        </div>

        {/* Countdown card */}
        <section className="mt-3 rounded-[20px] border border-border bg-card p-5 text-center">
          <div className={`text-lg font-bold ${TONE_TEXT[tone]}`}>
            {remainingSec === 0 ? "Service time is over" : "Service Ending Soon"}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {endMs ? `Ends at ${formatClock(endMs)}` : t("progress.waitingStart")}
          </div>

          <div className="mt-6 flex justify-center">
            <TimerRing progress={progress} tone={tone}>
              <span className="text-[11px] text-muted-foreground">
                {t("progress.timeRemaining")}
              </span>
              <span
                className="mt-1 font-mono text-3xl font-bold tabular-nums"
                style={{ color: TONE_HEX[tone] }}
              >
                {formatRemaining(remainingSec)}
              </span>
            </TimerRing>
          </div>

          {canExtend && (
            <button
              type="button"
              onClick={() => {
                void hapticImpact("medium");
                setSheetOpen(true);
              }}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full px-4 py-3.5 text-sm font-bold text-white active:scale-[0.99]"
              style={{ backgroundColor: TONE_HEX[tone] }}
            >
              <Plus className="h-4 w-4" />
              Extend Service
            </button>
          )}
        </section>

        {/* Check-out OTP */}
        <section className="mt-4 overflow-hidden rounded-[20px] border border-border bg-card">
          <div className="flex items-center justify-between gap-3 p-5">
            <div className="min-w-0">
              <div className="text-base font-bold text-foreground">Check-out OTP</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Share with expert to end service
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {(otp ?? "----").split("").map((d, i) => (
                <span
                  key={i}
                  className="flex h-11 w-9 items-center justify-center rounded-[10px] bg-foreground text-lg font-bold text-background"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
            <span className="text-sm text-foreground">Booked for someone else?</span>
            <button
              type="button"
              onClick={shareOtpOnWhatsApp}
              disabled={!otp}
              className="flex items-center gap-2 text-sm font-bold text-foreground disabled:opacity-50"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#25D366]">
                <WhatsAppGlyph />
              </span>
              Share OTP
            </button>
          </div>

          {onShowEndOtp && (
            <div className="px-5 pb-5">
              <button
                type="button"
                onClick={onShowEndOtp}
                className="w-full rounded-full bg-foreground px-4 py-3.5 text-sm font-bold text-background active:scale-[0.99]"
              >
                End Service
              </button>
            </div>
          )}
        </section>

        {/* Command-center banner */}
        {banner && (
          <section className="mt-4 overflow-hidden rounded-[20px] border border-border bg-primary/10">
            <div className="flex items-center gap-3 p-5">
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold text-foreground">
                  {banner.title ?? "Refer & Earn"}
                </div>
                {banner.subtitle && (
                  <div className="mt-0.5 text-xs text-muted-foreground">{banner.subtitle}</div>
                )}
                <button
                  type="button"
                  onClick={onReferNow}
                  className="mt-3 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground active:scale-[0.99]"
                >
                  {banner.button_label ?? "Refer now"}
                </button>
              </div>
              {banner.image_url ? (
                <img
                  src={banner.image_url}
                  alt=""
                  loading="lazy"
                  className="h-20 w-28 shrink-0 rounded-[12px] object-cover"
                />
              ) : null}
            </div>
          </section>
        )}

        {/* Expert + tip */}
        {expert && (
          <section className="mt-4 rounded-[20px] border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                {expert.photo_url ? (
                  <img
                    src={expert.photo_url}
                    alt={expert.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <User className="h-6 w-6 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold text-foreground">{expert.name}</div>
                {expert.review_count && expert.review_count > 0 && expert.avg_rating ? (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
                    <Star className="h-3 w-3 fill-primary text-primary" />
                    {Number(expert.avg_rating).toFixed(1)}
                  </span>
                ) : (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("track.verifiedExpert")}
                  </div>
                )}
              </div>
              {expert.phone && (
                <a
                  href={`tel:${expert.phone}`}
                  aria-label={t("track.callExpert")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border"
                >
                  <Phone className="h-4.5 w-4.5 text-foreground" />
                </a>
              )}
            </div>

            <div className="mt-5 rounded-[16px] border border-border p-4">
              {tipPaid ? (
                <div className="text-center">
                  <div className="text-sm font-bold text-foreground">
                    Thank you! ₹{tipPaid} tip sent
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    100% of it goes to {expert.name}.
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-sm font-bold text-foreground">Make their day with a tip</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    100% of the tip goes to the expert
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {TIP_AMOUNTS.map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        disabled={tipBusy !== null}
                        onClick={() => {
                          void hapticImpact("light");
                          payTip(amt);
                        }}
                        className="relative flex h-12 items-center justify-center rounded-[12px] border border-border bg-background text-sm font-bold text-foreground active:scale-[0.98] disabled:opacity-60"
                      >
                        {amt === 50 && (
                          <span className="absolute -top-2 rounded-full bg-primary px-2 text-[9px] font-bold text-primary-foreground">
                            Popular
                          </span>
                        )}
                        {tipBusy === amt ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                          `₹${amt}`
                        )}
                      </button>
                    ))}
                  </div>
                  {tipError && (
                    <p className="mt-3 text-center text-xs text-destructive">{tipError}</p>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* Booking details */}
        <section className="mt-4 rounded-[20px] border border-border bg-card p-5">
          <div className="flex items-center gap-3 text-sm text-foreground">
            <CalendarClock className="h-4.5 w-4.5 text-primary" />
            {totalDurationMin} min visit
          </div>
          {address && (
            <div className="mt-3 flex items-start gap-3 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-4.5 w-4.5 shrink-0 text-primary" />
              <span>
                {address.label ? `${address.label} | ` : ""}
                {address.full_address}
              </span>
            </div>
          )}
        </section>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Your expert will ask for the check-out code to end the service.
        </p>
      </div>

      {sheetOpen && (
        <ExtensionSheet
          options={extOptions}
          busyOptionId={busyOptionId}
          error={extError}
          onClose={() => {
            setSheetOpen(false);
            setExtError(null);
          }}
          onPick={buyExtension}
        />
      )}
    </main>
  );
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-white" aria-hidden="true">
      <path d="M12.04 2c-5.5 0-9.96 4.46-9.96 9.96 0 1.76.46 3.48 1.34 5L2 22l5.2-1.36a9.9 9.9 0 0 0 4.84 1.24h.01c5.5 0 9.96-4.46 9.96-9.96S17.54 2 12.04 2Zm5.8 14.06c-.24.68-1.4 1.3-1.94 1.34-.5.04-.98.22-3.3-.7-2.78-1.1-4.54-3.94-4.68-4.12-.14-.18-1.12-1.5-1.12-2.86s.72-2.02.98-2.3c.26-.28.56-.34.74-.34h.54c.18 0 .42-.06.64.5.24.58.8 2 .88 2.14.08.14.12.3.02.48-.1.18-.16.3-.3.46-.14.16-.3.36-.42.48-.14.14-.28.3-.12.58.16.28.72 1.18 1.54 1.92 1.06.94 1.94 1.24 2.22 1.38.28.14.44.12.6-.08.16-.2.7-.8.88-1.08.18-.28.36-.24.6-.14.24.1 1.56.74 1.82.87.26.14.44.2.5.32.06.12.06.68-.18 1.36Z" />
    </svg>
  );
}

function ExtensionSheet({
  options,
  busyOptionId,
  error,
  onClose,
  onPick,
}: {
  options: CatalogueItem[];
  busyOptionId: string | null;
  error: string | null;
  onClose: () => void;
  onPick: (o: CatalogueItem) => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="w-full max-w-md rounded-t-[22px] bg-card p-5 shadow-xl sm:rounded-[22px]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">{t("progress.extendTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("progress.extendSub")}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"
          >
            <X className="h-4 w-4 text-foreground" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {options.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("progress.loadingOptions")}
            </p>
          )}
          {options.map((o) => {
            const busy = busyOptionId === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={!!busyOptionId}
                onClick={() => onPick(o)}
                className="flex w-full items-center justify-between rounded-[14px] border border-border bg-background p-4 text-left transition active:scale-[0.99] disabled:opacity-60"
              >
                <div>
                  <div className="text-sm font-bold text-foreground">+{o.duration_label}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("progress.addsMinutes", { minutes: o.duration_minutes })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-primary">
                    {t("common.rupees", { amount: o.price })}
                  </span>
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                </div>
              </button>
            );
          })}
        </div>

        {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
