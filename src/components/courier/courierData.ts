// Shared reads for the courier (parcel delivery) flow.
// Everything here is read-only config; fares and dispatch stay server-side.
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";

export type CourierVehicle = {
  id: string;
  name: string;
  icon: string | null;
  max_weight_kg: number | null;
  inclusions: string[] | null;
  exclusions: string[] | null;
};

export type CourierType = {
  id: string;
  name: string;
  icon: string | null;
  extra_fee: number | null;
  instructions: string | null;
};

export type CourierOrder = {
  id: string;
  order_code: string | null;
  status: string;
  city: string | null;
  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  pickup_contact_edit_count: number | null;
  drop_address: string;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_contact_name: string | null;
  drop_contact_phone: string | null;
  drop_contact_edit_count: number | null;
  distance_km: number | null;
  total_amount: number | null;
  payment_status: string | null;
  package_description: string | null;
  assigned_expert_id: string | null;
  cancel_reason_code: string | null;
  delivered_at: string | null;
  created_at: string;
  pickup_count?: number | null;
  drop_count?: number | null;
  base_amount?: number | null;
  extra_fee?: number | null;
  platform_fee?: number | null;
  stops_fee?: number | null;
  discount_amount?: number | null;
  coupon_code?: string | null;
  gst_percent?: number | null;
  gst_amount?: number | null;
};

const COURIER_ORDER_COLUMNS =
  "id, order_code, status, city, pickup_address, pickup_lat, pickup_lng, pickup_contact_name, pickup_contact_phone, pickup_contact_edit_count, drop_address, drop_lat, drop_lng, drop_contact_name, drop_contact_phone, drop_contact_edit_count, distance_km, total_amount, payment_status, package_description, assigned_expert_id, cancel_reason_code, delivered_at, created_at, pickup_count, drop_count, base_amount, extra_fee, platform_fee, stops_fee, discount_amount, coupon_code, gst_percent, gst_amount";

/** Is courier live, and for which city? */
export async function fetchCourierService(
  city?: string | null,
): Promise<{ enabled: boolean; city: string | null }> {
  const { data, error } = await supabase
    .from("service_flags")
    .select("is_active, city")
    .eq("service_key", "courier");
  if (error) return { enabled: false, city: null };
  const rows = data ?? [];
  if (!rows.length) return { enabled: false, city: null };
  const key = (city ?? "").trim().toLowerCase();
  const forCity = key
    ? rows.find((r) => (r.city ?? "").trim().toLowerCase() === key)
    : null;
  const active = rows.find((r) => r.is_active) ?? null;
  const row = forCity ?? active ?? rows[0];
  return { enabled: Boolean(row?.is_active), city: row?.city ?? null };
}

/** Is courier live for this city? */
export async function fetchCourierEnabled(city?: string | null) {
  return (await fetchCourierService(city)).enabled;
}

export async function fetchCourierVehicles(): Promise<CourierVehicle[]> {
  const { data, error } = await supabase
    .from("courier_vehicle_types")
    .select("id, name, icon, max_weight_kg, inclusions, exclusions, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as CourierVehicle[];
}

export async function fetchCourierTypes(vehicleId?: string | null): Promise<CourierType[]> {
  const { data, error } = await supabase
    .from("courier_types")
    .select("id, name, icon, extra_fee, instructions, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  const all = (data ?? []) as CourierType[];
  if (!vehicleId) return all;

  const { data: map } = await supabase
    .from("courier_vehicle_courier_types")
    .select("courier_type_id")
    .eq("vehicle_type_id", vehicleId)
    .eq("is_active", true);
  const allowed = new Set((map ?? []).map((m) => m.courier_type_id));
  return allowed.size ? all.filter((c) => allowed.has(c.id)) : all;
}

export const COURIER_ACTIVE_STATUSES = [
  "REQUESTED",
  "SEARCHING",
  "DRIVER_ASSIGNED",
  "ARRIVED_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
];
export const COURIER_PAST_STATUSES = ["DELIVERED", "COMPLETED", "CANCELLED", "EXPIRED", "FAILED"];

export async function fetchMyCourierOrders(): Promise<CourierOrder[]> {
  const { data: userRes } = await getAuthUser();
  const uid = userRes.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("courier_orders")
    .select(
      COURIER_ORDER_COLUMNS,
    )
    .eq("customer_id", uid)
    // Store deliveries show under the shop order, not as a separate parcel.
    .is("store_order_id", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return (data ?? []) as CourierOrder[];
}

export async function fetchCourierOrder(id: string): Promise<CourierOrder | null> {
  const { data, error } = await supabase
    .from("courier_orders")
    .select(
      COURIER_ORDER_COLUMNS,
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CourierOrder | null) ?? null;
}

export const COURIER_STEPS: Array<{ key: string; label: string }> = [
  { key: "REQUESTED", label: "Order placed" },
  { key: "SEARCHING", label: "Finding a rider" },
  { key: "DRIVER_ASSIGNED", label: "Rider on the way" },
  { key: "ARRIVED_PICKUP", label: "At pickup" },
  { key: "PICKED_UP", label: "Parcel picked up" },
  { key: "IN_TRANSIT", label: "On the way to drop" },
  { key: "DELIVERED", label: "Delivered" },
];

export function courierStepIndex(status: string) {
  const i = COURIER_STEPS.findIndex((s) => s.key === status);
  if (status === "COMPLETED") return COURIER_STEPS.length - 1;
  return i;
}

/** Compact 5-stage tracker shown at the top of the tracking screen. */
export const COURIER_STAGES: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "placed", label: "Placed", statuses: ["REQUESTED"] },
  { key: "rider", label: "Rider", statuses: ["SEARCHING", "DRIVER_ASSIGNED"] },
  { key: "pickup", label: "Pickup", statuses: ["ARRIVED_PICKUP"] },
  { key: "transit", label: "On the way", statuses: ["PICKED_UP", "IN_TRANSIT"] },
  { key: "delivered", label: "Delivered", statuses: ["DELIVERED", "COMPLETED"] },
];

export function courierStageIndex(status: string) {
  const i = COURIER_STAGES.findIndex((s) => s.statuses.includes(status));
  return i < 0 ? 0 : i;
}

export type RiderLocation = {
  available: boolean;
  lat?: number;
  lng?: number;
  location_updated_at?: string;
  stale?: boolean;
  reason?: string;
};

export async function fetchRiderLocation(orderId: string): Promise<RiderLocation | null> {
  const { data, error } = await supabase.rpc("courier_get_rider_location", {
    _order_id: orderId,
  });
  if (error) return null;
  return (data as unknown as RiderLocation) ?? null;
}

export type RiderInfo = {
  available: boolean;
  name?: string | null;
  phone?: string | null;
  photo_url?: string | null;
};

export async function fetchRiderInfo(orderId: string): Promise<RiderInfo | null> {
  const { data, error } = await supabase.rpc("courier_get_rider_info", {
    _order_id: orderId,
  });
  if (error) return null;
  return (data as unknown as RiderInfo) ?? null;
}

/** Reads the live OTP for the current stage straight into the app. */
export async function fetchCourierOtp(
  orderId: string,
  purpose: "pickup" | "delivery",
): Promise<string | null> {
  const { data, error } = await supabase.rpc("courier_get_otp", {
    _order_id: orderId,
    _purpose: purpose,
  });
  if (error) return null;
  const payload = data as unknown as { otp?: string | null } | null;
  return payload?.otp ?? null;
}

// ---- Multi-stop reads (RLS: same readers as the parcel order) ----
export type CourierStop = {
  id: string;
  stop_type: "pickup" | "drop" | "return";
  sequence: number;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_edit_count: number | null;
  status: string;
  lat: number | null;
  lng: number | null;
};
export type CourierParcel = {
  id: string;
  pickup_stop_id: string | null;
  drop_stop_id: string | null;
  return_stop_id: string | null;
  status: string;
};
export type CourierCharge = {
  id: string;
  order_id: string;
  status: string;
  total_amount: number;
  parcel_id?: string | null;
};

export async function fetchCourierStops(orderId: string): Promise<CourierStop[]> {
  const { data, error } = await supabase
    .from("courier_order_stops" as never)
    .select("id, stop_type, sequence, address, contact_name, contact_phone, contact_edit_count, status, lat, lng")
    .eq("order_id", orderId)
    .order("sequence", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CourierStop[];
}

export async function fetchCourierParcels(orderId: string): Promise<CourierParcel[]> {
  const { data, error } = await supabase
    .from("courier_order_parcels" as never)
    .select("id, pickup_stop_id, drop_stop_id, return_stop_id, status")
    .eq("order_id", orderId);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CourierParcel[];
}

export async function fetchCourierCharges(orderId: string): Promise<CourierCharge[]> {
  const { data, error } = await supabase
    .from("courier_order_charges" as never)
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CourierCharge[];
}

/** Order ids (of the given list) that have an unpaid return charge. */
export async function fetchPendingReturnOrderIds(orderIds: string[]): Promise<string[]> {
  if (!orderIds.length) return [];
  const { data } = await supabase
    .from("courier_order_charges" as never)
    .select("order_id")
    .in("order_id", orderIds)
    .eq("status", "pending");
  return Array.from(new Set(((data ?? []) as unknown as Array<{ order_id: string }>).map((r) => r.order_id)));
}

/** Fare breakup lines for a parcel order, in the order a bill reads. */
export function courierBillLines(o: CourierOrder): Array<{ label: string; value: number; muted?: boolean; discount?: boolean }> {
  const lines: Array<{ label: string; value: number; muted?: boolean; discount?: boolean }> = [];
  const base = Number(o.base_amount ?? 0);
  lines.push({
    label: o.distance_km ? `Delivery fare (${Number(o.distance_km)} km)` : "Delivery fare",
    value: base,
  });
  const stops = Number(o.stops_fee ?? 0);
  if (stops > 0) lines.push({ label: "Extra stops", value: stops, muted: true });
  const extra = Number(o.extra_fee ?? 0);
  if (extra > 0) lines.push({ label: "Service type fee", value: extra, muted: true });
  const platform = Number(o.platform_fee ?? 0);
  if (platform > 0) lines.push({ label: "Platform fee", value: platform, muted: true });
  const discount = Number(o.discount_amount ?? 0);
  if (discount > 0)
    lines.push({
      label: o.coupon_code ? `Coupon ${o.coupon_code}` : "Discount",
      value: discount,
      discount: true,
    });
  const gst = Number(o.gst_amount ?? 0);
  if (gst > 0)
    lines.push({ label: `GST (${Number(o.gst_percent ?? 0)}%)`, value: gst, muted: true });
  return lines;
}
