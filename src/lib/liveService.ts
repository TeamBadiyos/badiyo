import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActiveBooking = {
  id: string;
  status: string;
  service_duration_minutes: number;
  service_end_at: string | null;
  started_at: string | null;
};

export const ACTIVE_BOOKING_KEY = ["active-live-booking"] as const;

async function fetchActiveBooking(): Promise<ActiveBooking | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data, error } = await supabase
    .from("bookings")
    .select("id, status, service_duration_minutes, service_end_at, started_at")
    .eq("user_id", userData.user.id)
    .eq("status", "in_progress")
    .is("deleted_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("fetchActiveBooking failed:", error);
    return null;
  }
  return (data as ActiveBooking | null) ?? null;
}

/** The customer's currently running service, if any. Cheap + shared across screens. */
export function useActiveBooking(enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ACTIVE_BOOKING_KEY,
    queryFn: fetchActiveBooking,
    enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const bookingId = query.data?.id ?? null;
  useEffect(() => {
    if (!bookingId) return;
    const channel = supabase
      .channel(`live-bar-${bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        (payload) => {
          const row = payload.new as Partial<ActiveBooking> & { deleted_at?: string | null };
          if (row.status !== "in_progress" || row.deleted_at) {
            qc.setQueryData(ACTIVE_BOOKING_KEY, null);
            return;
          }
          qc.setQueryData<ActiveBooking | null>(ACTIVE_BOOKING_KEY, (prev) =>
            prev ? { ...prev, ...row } : prev,
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, qc]);

  return query.data ?? null;
}

/** Re-renders every second so countdowns tick. */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export type TimerTone = "ok" | "warn" | "danger";

/** >15 min green, <=15 min amber, <=5 min red. */
export function toneForRemaining(sec: number): TimerTone {
  if (sec <= 5 * 60) return "danger";
  if (sec <= 15 * 60) return "warn";
  return "ok";
}

export const TONE_HEX: Record<TimerTone, string> = {
  ok: "#00B97A",
  warn: "#E5A50A",
  danger: "#E5484D",
};

export const TONE_TEXT: Record<TimerTone, string> = {
  ok: "text-primary",
  warn: "text-[#E5A50A]",
  danger: "text-[#E5484D]",
};

export function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function formatRemaining(sec: number) {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(r)}`;
  return `${pad(m)}:${pad(r)}`;
}

export function formatClock(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDayTime(ms: number | null): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString([], { month: "short" })}, ${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
