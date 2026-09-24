/**
 * Store order placement and history.
 *
 * Every price, the delivery fee and the shop's open state are decided by the
 * database (`store_create_order`); the app only sends product ids, quantities
 * and the chosen address.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CartLine } from "@/lib/storeCart";

export type StoreOrderItem = { name: string; price: number; quantity: number };

export type StoreOrder = {
  id: string;
  order_number: string;
  status: string;
  payment_mode: string;
  payment_status: string;
  items_total: number;
  delivery_fee: number;
  total_amount: number;
  delivery_address: string | null;
  created_at: string;
  store_name: string | null;
  store_photo_url: string | null;
  items: StoreOrderItem[];
};

export type DeliveryQuote = {
  delivery_fee: number;
  free_delivery_above: number;
  min_order_amount: number;
  total: number;
};

type RpcResult = Record<string, unknown>;

async function rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return (data ?? {}) as RpcResult;
}

export type CourierDeliveryQuote =
  | { ok: true; delivery_fee: number; distance_km: number }
  | { ok: false; code: string };

/** Delivery fee = parcel (Expert) fare from the shop to this address, worked out by the server. */
export async function fetchStoreDeliveryQuote(
  merchantId: string,
  addressId: string,
): Promise<CourierDeliveryQuote> {
  const data = await rpc("store_quote_delivery", { _merchant_id: merchantId, _address_id: addressId });
  if (data.ok !== true) return { ok: false, code: String(data.code ?? "delivery_unavailable") };
  return {
    ok: true,
    delivery_fee: Number(data.delivery_fee ?? 0),
    distance_km: Number(data.distance_km ?? 0),
  };
}

export function useStoreDeliveryQuote(merchantId: string | null, addressId: string | null) {
  return useQuery({
    queryKey: ["store_quote_delivery", merchantId, addressId],
    queryFn: () => fetchStoreDeliveryQuote(merchantId!, addressId!),
    enabled: !!merchantId && !!addressId,
    staleTime: 5 * 60_000,
  });
}

/** Customer's delivery code for a store order (available once the Expert has picked it up). */
export async function fetchStoreDeliveryOtp(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("store_get_delivery_otp" as never, { _order_id: orderId } as never);
  if (error) return null;
  const otp = (data as { otp?: string } | null)?.otp;
  return otp ? String(otp) : null;
}

export type CreatedOrder = {
  order_id: string;
  order_number: string;
  items_total: number;
  delivery_fee: number;
  total_amount: number;
  payment_mode: string;
};

export class StoreOrderError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = "StoreOrderError";
    this.code = code;
  }
}

export async function createStoreOrder(params: {
  merchantId: string;
  lines: CartLine[];
  addressId: string;
  paymentMode: "online";
  note?: string | null;
}): Promise<CreatedOrder> {
  const data = await rpc("store_create_order", {
    _merchant_id: params.merchantId,
    _items: params.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
    _address_id: params.addressId,
    _payment_mode: params.paymentMode,
    _note: params.note ?? null,
  });
  if (data.ok !== true) throw new StoreOrderError(String(data.code ?? "order_failed"));
  return {
    order_id: String(data.order_id),
    order_number: String(data.order_number),
    items_total: Number(data.items_total ?? 0),
    delivery_fee: Number(data.delivery_fee ?? 0),
    total_amount: Number(data.total_amount ?? 0),
    payment_mode: String(data.payment_mode ?? params.paymentMode),
  };
}

export async function attachStorePayment(orderId: string, razorpayOrderId: string) {
  await rpc("store_attach_payment", { _order_id: orderId, _rzp_order_id: razorpayOrderId });
}

export async function confirmStorePayment(
  orderId: string,
  razorpayOrderId: string,
  paymentId: string,
) {
  const data = await rpc("store_confirm_payment", {
    _order_id: orderId,
    _rzp_order_id: razorpayOrderId,
    _payment_id: paymentId,
  });
  if (data.ok !== true) throw new StoreOrderError(String(data.code ?? "confirm_failed"));
}

export async function cancelStoreOrder(orderId: string, reason?: string) {
  const data = await rpc("store_cancel_order", { _order_id: orderId, _reason: reason ?? null });
  if (data.ok !== true) throw new StoreOrderError(String(data.code ?? "cancel_failed"));
}

export async function fetchMyStoreOrders(): Promise<StoreOrder[]> {
  const { data, error } = await supabase.rpc("store_my_orders" as never);
  if (error) throw error;
  return ((data ?? []) as unknown as StoreOrder[]).map((o) => ({
    ...o,
    items_total: Number(o.items_total ?? 0),
    delivery_fee: Number(o.delivery_fee ?? 0),
    total_amount: Number(o.total_amount ?? 0),
    items: (o.items ?? []).map((i) => ({ ...i, price: Number(i.price), quantity: Number(i.quantity) })),
  }));
}

export const STORE_ACTIVE_STATUSES = [
  "pending",
  "paid",
  "placed",
  "accepted",
  "expert_assigned",
  "picked_up",
  "needs_attention",
  "preparing",
  "ready",
  "out_for_delivery",
  "dispatched",
];

export function isStoreOrderActive(o: StoreOrder): boolean {
  const s = String(o.status).toLowerCase();
  // An unpaid online order that was never paid is not "active" for the customer.
  if (s === "pending" && o.payment_mode === "online" && o.payment_status !== "paid") {
    return Date.now() - new Date(o.created_at).getTime() < 30 * 60_000;
  }
  return STORE_ACTIVE_STATUSES.includes(s);
}
