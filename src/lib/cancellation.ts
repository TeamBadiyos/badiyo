import { supabase } from "@/integrations/supabase/client";
import { getCustomerCityId } from "@/lib/customerCity";

export type CancelPolicy = { fee_percent: number; lines_en: string[]; lines_mr: string[] };
export type CancelQuote = {
  can_cancel?: boolean;
  refund_amount?: number;
  fee_amount?: number;
  fee_percent?: number;
  paid?: number;
  [k: string]: unknown;
};
export type RefundDestination = "wallet" | "original";

const rpc = (fn: string, args: Record<string, unknown>) => supabase.rpc(fn as never, args as never);

export async function fetchCancellationPolicy(serviceKey: string): Promise<CancelPolicy | null> {
  const { data, error } = await rpc("app_cancellation_policy", { _service_key: serviceKey, _city_id: getCustomerCityId() });
  if (error) throw error;
  return (data ?? null) as CancelPolicy | null;
}

export async function fetchCancelQuote(bookingId: string): Promise<CancelQuote> {
  const { data, error } = await rpc("app_cancel_quote", { _booking_id: bookingId });
  if (error) throw error;
  return (data ?? {}) as CancelQuote;
}

export async function cancelBookingTo(bookingId: string, destination: RefundDestination) {
  const { data, error } = await rpc("app_cancel_booking", { _booking_id: bookingId, _destination: destination });
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

/** Numeric field from a quote, trying several possible key names. */
export function num(q: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = q?.[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
