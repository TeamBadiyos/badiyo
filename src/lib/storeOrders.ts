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

export async function fetchDeliveryQuote(itemsTotal: number): Promise<DeliveryQuote> {
  const data = await rpc("store_delivery_quote", { _items_total: itemsTotal });
  return {
    delivery_fee: Number(data.delivery_fee ?? 0),
    free_delivery_above: Number(data.free_delivery_above ?? 0),
    min_order_amount: Number(data.min_order_amount ?? 0),
    total: Number(data.total ?? itemsTotal),
  };
}

export function useDeliveryQuote(itemsTotal: number) {
  return useQuery({
    queryKey: ["store_delivery_quote", itemsTotal],
    queryFn: () => fetchDeliveryQuote(itemsTotal),
    enabled: itemsTotal > 0,
    staleTime: 5 * 60_000,
  });
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
  paymentMode: "cod" | "online";
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
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "dispatched",
];

export function isStoreOrderActive(o: StoreOrder): boolean {
  return STORE_ACTIVE_STATUSES.includes(String(o.status).toLowerCase());
}
