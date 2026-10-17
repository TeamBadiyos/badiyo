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

export type StoreCancelQuote = {
  can_cancel: boolean;
  reason_code?: string | null;
  message_en?: string;
  message_mr?: string;
  refund_total?: number;
};

export async function fetchStoreCancelQuote(orderId: string): Promise<StoreCancelQuote> {
  const { data, error } = await rpc("app_store_cancel_quote", { _order_id: orderId });
  if (error) throw error;
  return (data ?? { can_cancel: false }) as StoreCancelQuote;
}

export async function cancelStoreOrderTo(orderId: string, destination: RefundDestination, reason?: string) {
  const { data, error } = await rpc("app_store_cancel_order", { _order_id: orderId, _destination: destination, _reason: reason ?? null });
  if (error) throw error;
  const r = (data ?? {}) as { ok?: boolean; code?: string; refund_total?: number };
  if (r.ok !== true) throw new Error(r.code ?? "cancel_failed");
  return r;
}

/** Numeric field from a quote, trying several possible key names. */
export function num(q: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = q?.[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
