import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Plus, X, Loader2, AlertTriangle, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n";
import { getErrorMessage } from "@/lib/errorMessage";
import { StageTracker, stageFromStatus } from "./StageTracker";
import { ServiceLocationMap } from "./ServiceLocationMap";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import type { SelectedAddress } from "../BookingSummaryScreen";



type BookingTiming = {
  id: string;
  status: string;
  service_duration_minutes: number;
  service_end_at: string | null;
  deleted_at: string | null;
};

type CatalogueItem = {
  id: string;
  duration_minutes: number;
  duration_label: string;
  price: number;
};

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
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
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
    .select("id, status, service_duration_minutes, service_end_at, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("fetchBookingTiming failed:", error);
    return null;
  }
  return (data as BookingTiming | null) ?? null;
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

function pad(n: number) {
  return n.toString().padStart(2, "0");
}
function formatRemaining(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(r)}`;
  return `${pad(m)}:${pad(r)}`;
}

export function ServiceInProgressScreen({
  bookingId,
  address,
  onShowEndOtp,
  onAdvanceCompleted,
  onCancelled,
  onBack,
}: {
  bookingId: string | null;
  address?: SelectedAddress | null;
  onShowEndOtp?: () => void;
  onAdvanceCompleted?: () => void;
  onCancelled?: () => void;
  onBack?: () => void;
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
            row.status === "cancelled" ||
            row.status === "rejected" ||
            !!row.deleted_at;
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

  // Ticking clock — recomputes every second from service_end_at.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const endMs = timing?.service_end_at ? Date.parse(timing.service_end_at) : null;
  const totalDurationMin = timing?.service_duration_minutes ?? 0;
  const remainingSec =
    endMs != null ? Math.max(0, Math.floor((endMs - now) / 1000)) : totalDurationMin * 60;
  const isEnded = endMs != null && remainingSec === 0;
  const graceOpen =
    endMs != null && now <= endMs + 10 * 60 * 1000; // 10 min grace after end

  // Banner + sound state machine
  const [banner, setBanner] = useState<"none" | "warn" | "end" | "dismissed-warn">("none");
  const warnedRef = useRef(false);
  const endedRef = useRef(false);
  useEffect(() => {
    if (endMs == null) return;
    if (!warnedRef.current && remainingSec > 0 && remainingSec <= 300) {
      warnedRef.current = true;
      beep("warning");
      setBanner((b) => (b === "dismissed-warn" ? b : "warn"));
    }
    if (!endedRef.current && remainingSec === 0) {
      endedRef.current = true;
      beep("end");
      setBanner("end");
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
            // Optimistically update timing so countdown reflects immediately.
            qc.setQueryData<BookingTiming | null>(
              ["booking-timing", bookingId],
              (prev) =>
                prev
                  ? { ...prev, service_end_at: (newEnd as string) ?? prev.service_end_at }
                  : prev,
            );
            qc.invalidateQueries({ queryKey: ["booking-timing", bookingId] });
            // Reset alert state so we get a fresh 5-min warning next time.
            warnedRef.current = false;
            endedRef.current = false;
            setBanner("none");
            setSheetOpen(false);
            resolve();
          },
          modal: {
            ondismiss: () => reject(new Error("Payment cancelled")),
          },
        });
        rzp.open();
      });
    } catch (e) {
      setExtError(await getErrorMessage(e));
    } finally {
      setBusyOptionId(null);
    }
  }

  const canExtend = timing?.status === "in_progress" && (remainingSec > 0 || graceOpen);

  const bannerNode = useMemo(() => {
    if (banner === "warn") {
      return (
        <BannerCard
          tone="warn"
          title={t("progress.fiveLeft")}
          onExtend={() => setSheetOpen(true)}
          onDismiss={() => setBanner("dismissed-warn")}
        />
      );
    }
    if (banner === "end") {
      return (
        <BannerCard
          tone="end"
          title={t("progress.timesUp")}
          onExtend={canExtend ? () => setSheetOpen(true) : undefined}
          onDismiss={() => setBanner("none")}
        />
      );
    }
    return null;
  }, [banner, canExtend]);

  return (
    <main className="min-h-screen w-full bg-background">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pt-6 pb-8">
        <div className="mb-6">
          <StageTracker stage={stageFromStatus(timing?.status)} />
        </div>
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 animate-pulse">
            <Sparkles className="h-10 w-10 text-primary" />
          </div>
          <h1 className="mt-6 text-xl font-bold text-foreground">
            {t("progress.title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("progress.sub")}
          </p>
        </div>

        <div className="mt-10 rounded-[18px] border border-border bg-card p-6 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("progress.timeRemaining")}
          </div>
          <div className="mt-2 font-mono text-4xl font-bold tabular-nums text-foreground">
            {formatRemaining(remainingSec)}
          </div>
          {endMs == null && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              {t("progress.waitingStart")}
            </div>
          )}
        </div>

        {bannerNode && <div className="mt-4">{bannerNode}</div>}

        {address && (
          <section className="mt-5 overflow-hidden rounded-[18px] border border-border bg-card p-4">
            <div className="text-sm font-bold text-foreground">{t("progress.serviceLocation")}</div>
            <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {address.full_address}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {t("progress.liveSoon")}
            </div>
          </section>
        )}


        <div className="mt-auto pt-10 space-y-3">
          {canExtend && banner !== "warn" && banner !== "end" && (
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-primary bg-primary/10 px-4 py-3.5 text-sm font-bold text-primary active:scale-[0.99]"
            >
              <Plus className="h-4 w-4" />
              Extend time
            </button>
          )}
          {onShowEndOtp && (
            <button
              type="button"
              onClick={onShowEndOtp}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground active:scale-[0.99]"
            >
              Show completion code
            </button>
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            Your expert will ask for the completion code to end the service.
          </p>
        </div>
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

function BannerCard({
  tone,
  title,
  onExtend,
  onDismiss,
}: {
  tone: "warn" | "end";
  title: string;
  onExtend?: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const isEnd = tone === "end";
  return (
    <div
      className={`rounded-[16px] border p-4 ${
        isEnd
          ? "border-destructive/40 bg-destructive/10"
          : "border-primary/40 bg-primary/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isEnd ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"
          }`}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-foreground">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {isEnd
              ? t("progress.extendNow")
              : t("progress.needMore")}
          </div>
          <div className="mt-3 flex gap-2">
            {onExtend && (
              <button
                type="button"
                onClick={onExtend}
                className={`rounded-[12px] px-3 py-2 text-xs font-bold text-primary-foreground active:scale-[0.99] ${
                  isEnd ? "bg-destructive" : "bg-primary"
                }`}
              >
                {t("progress.extendTime")}
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-[12px] border border-border bg-card px-3 py-2 text-xs font-bold text-foreground"
            >
              {t("progress.dismiss")}
            </button>
          </div>
        </div>
      </div>
    </div>
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
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("progress.extendSub")}
            </p>
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
                  <div className="text-sm font-bold text-foreground">
                    +{o.duration_label}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("progress.addsMinutes", { minutes: o.duration_minutes })}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-primary">{t("common.rupees", { amount: o.price })}</span>
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-center text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
