import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerCityId, getCustomerCityId } from "@/lib/customerCity";
import { useGstPercent } from "@/lib/gst";
import type { ServiceState } from "@/lib/serviceHours";

/** Clean Home = 'clean', Car & Bike Wash = 'wash'. Public RPCs, city-aware. */
export type CleanServiceKey = "clean" | "wash";

const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export function useServiceHours(key: CleanServiceKey, enabled = true) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-service-hours", key, cityId],
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ServiceState | null> => {
      const { data, error } = await rpc("app_service_hours", { _service_key: key, _city_id: cityId });
      if (error) return null; // fail-open
      return ((data as { state?: ServiceState } | null)?.state ?? null) as ServiceState | null;
    },
  });
}

export type BookNowGate = { allowed: boolean; reason: "book_now_off" | "closed" | "slot_full" | null };

export function useBookNowAllowed(key: CleanServiceKey, enabled = true) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-book-now-allowed", key, cityId],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<BookNowGate> => {
      const { data, error } = await rpc("app_book_now_allowed", { _service_key: key, _city_id: cityId });
      if (error || !data) return { allowed: true, reason: null };
      const d = data as { allowed?: boolean; reason?: BookNowGate["reason"] };
      return { allowed: d.allowed !== false, reason: d.allowed === false ? (d.reason ?? "slot_full") : null };
    },
  });
}

export async function fetchAppFullySlots(key: CleanServiceKey, from: string, to: string): Promise<Set<string>> {
  const { data, error } = await rpc("app_fully_booked_slots", { _service_key: key, _city_id: getCustomerCityId(), _from: from, _to: to });
  if (error || !Array.isArray(data)) return new Set();
  return new Set(
    (data as { slot_date: string; start_hour: number; start_minute?: number }[]).map(
      (r) => `${String(r.slot_date).slice(0, 10)}|${Number(r.start_hour) * 60 + Number(r.start_minute ?? 0)}`,
    ),
  );
}

export type BookingQuote = { price: number; gst_rate: number; gst_amount: number; total: number };

export function useBookingQuote(priceOptionId: string | null | undefined) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-booking-quote", priceOptionId, cityId],
    enabled: !!priceOptionId,
    staleTime: 60_000,
    queryFn: async (): Promise<BookingQuote | null> => {
      const { data, error } = await rpc("app_booking_quote", { _price_option_id: priceOptionId, _city_id: cityId });
      if (error || !data) return null;
      const d = data as Record<string, unknown>;
      return { price: Number(d.price), gst_rate: Number(d.gst_rate), gst_amount: Number(d.gst_amount), total: Number(d.total) };
    },
  });
}

/** GST % for this price option from the backend quote; falls back to the general rate. */
export function useBookingGstPercent(priceOptionId: string | null | undefined): number {
  const fallback = useGstPercent();
  const { data } = useBookingQuote(priceOptionId);
  return data && Number.isFinite(data.gst_rate) ? data.gst_rate : fallback;
}
