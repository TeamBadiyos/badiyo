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

/** Parse "9:00 AM – 10:00 AM" / "10:00 AM - 12:00 PM" style range → start hour (24h). */
export function slotStartHour(range: string): number | null {
  const m = range.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const meridiem = m[3].toUpperCase();
  if (meridiem === "AM") {
    if (h === 12) h = 0;
  } else if (h !== 12) h += 12;
  return h;
}

/** Local check against a fetched state: does a slot starting at `hour` fit the open window? */
export function slotFitsWindow(
  state: ServiceState | null | undefined,
  hour: number,
  durationMinutes: number,
): boolean {
  if (!state || state.open_time == null || state.close_time == null) return true; // fail-open
  const openH = parseInt(state.open_time.slice(0, 2), 10);
  const closeH = parseInt(state.close_time.slice(0, 2), 10);
  const endHour = hour + durationMinutes / 60;
  return hour >= openH && endHour <= closeH + 1e-9;
}
