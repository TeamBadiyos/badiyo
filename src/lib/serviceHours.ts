import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export type ServiceState = {
  status: "live" | "coming_soon" | "temporarily_stopped" | "hidden";
  visible: boolean;
  can_order: boolean;
  open: boolean;
  reason_code: string;
  message_en: string | null;
  message_mr: string | null;
  open_time?: string | null;
  close_time?: string | null;
  last_order_at?: string | null;
  next_open_at?: string | null;
  resume_at?: string | null;
};

/** Effective state of a service (status + hours + holidays), evaluated server-side in IST. Fail-open. */
export async function fetchServiceState(serviceKey: string): Promise<ServiceState | null> {
  const { data, error } = await supabase.rpc("service_effective_state", {
    _service_key: serviceKey,
  });
  if (error) {
    console.error("service_effective_state failed:", error);
    return null; // fail-open: treat as available
  }
  return (data as ServiceState | null) ?? null;
}

export function useServiceState(serviceKey: string, enabled = true) {
  return useQuery({
    queryKey: ["service-state", serviceKey],
    queryFn: () => fetchServiceState(serviceKey),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Is a specific slot allowed on a date? Fail-open on error. */
export async function fetchSlotAllowed(
  serviceKey: string,
  date: string,
  slotRange: string,
  durationMinutes: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("service_slot_allowed", {
    _service_key: serviceKey,
    _date: date,
    _slot: slotRange,
    _duration_minutes: durationMinutes,
  });
  if (error) return true;
  return Boolean((data as { ok?: boolean } | null)?.ok);
}

/** Is "Book Now" (instant) open? Fail-open on error. */
export async function fetchInstantBookingEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc("instant_booking_enabled" as never);
  if (error) return true;
  return data !== false;
}

/** Set of "YYYY-MM-DD|minutesOfDay" keys marked Fully Booked. Empty on error. */
export async function fetchFullyBookedSlots(
  serviceKey: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const { data, error } = await supabase.rpc(
    "list_fully_booked_slots" as never,
    { _service_key: serviceKey, _from: from, _to: to } as never,
  );
  if (error || !Array.isArray(data)) return new Set();
  return new Set(
    (data as { slot_date: string; start_hour: number; start_minute?: number }[]).map(
      (r) =>
        `${String(r.slot_date).slice(0, 10)}|${Number(r.start_hour) * 60 + Number(r.start_minute ?? 0)}`,
    ),
  );
}

/** "Notify me" for a Coming Soon service. Returns false when already on the list. */
export async function notifyMeForService(serviceKey: string): Promise<"added" | "duplicate" | "error"> {
  const { data, error } = await supabase.rpc("customer_notify_me", {
    _service_key: serviceKey,
  });
  if (error) return "error";
  const d = data as { ok?: boolean; duplicate?: boolean } | null;
  if (d?.duplicate) return "duplicate";
  return d?.ok ? "added" : "error";
}

/** Format a timestamptz into a friendly "tomorrow 9 AM" style label (device locale). */
export function formatNextOpen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const day = isTomorrow
    ? "tomorrow"
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${day} ${time}`;
}

/** Parse "10:30 AM – 11:30 AM" style range → start time in minutes since midnight. */
export function slotStartMinutes(range: string): number | null {
  const m = range.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const meridiem = m[3].toUpperCase();
  if (meridiem === "AM") {
    if (h === 12) h = 0;
  } else if (h !== 12) h += 12;
  return h * 60 + (m[2] ? parseInt(m[2], 10) : 0);
}

/** Start hour (24h) of a slot range. */
export function slotStartHour(range: string): number | null {
  const m = slotStartMinutes(range);
  return m == null ? null : Math.floor(m / 60);
}

/** Local check: does a slot starting at `startMins` (minutes since midnight) fit the open window? */
export function slotFitsWindow(
  state: ServiceState | null | undefined,
  startMins: number,
  durationMinutes: number,
): boolean {
  const open = timeToMinutes(state?.open_time);
  const close = timeToMinutes(state?.close_time);
  if (open == null || close == null) return true; // fail-open
  return startMins >= open && startMins + durationMinutes <= close;
}

/** "19:00:00" -> minutes since midnight. Null when unparsable. */
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Current minutes since midnight in IST (service timezone). */
export function istNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const [h, mi] = parts.split(":").map((x) => parseInt(x, 10));
  return h * 60 + mi;
}

/**
 * Instant booking: starting right now, would the service still end before closing?
 * Fail-open when hours are unknown.
 */
export function durationFitsNow(
  state: ServiceState | null | undefined,
  durationMinutes: number,
): boolean {
  const close = timeToMinutes(state?.close_time);
  if (close == null) return true;
  return istNowMinutes() + Math.max(durationMinutes, 1) <= close;
}

/** "19:00:00" -> "7:00 PM" */
export function formatClockLabel(t: string | null | undefined): string | null {
  const mins = timeToMinutes(t);
  if (mins == null) return null;
  const h24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** Human duration: 480 -> "8 hours", 90 -> "1 hr 30 min" */
export function formatDurationLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h} hr ${m} min`;
}
