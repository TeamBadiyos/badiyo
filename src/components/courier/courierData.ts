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
};

const COURIER_ORDER_COLUMNS =
  "id, order_code, status, city, pickup_address, pickup_lat, pickup_lng, pickup_contact_name, pickup_contact_phone, pickup_contact_edit_count, drop_address, drop_lat, drop_lng, drop_contact_name, drop_contact_phone, drop_contact_edit_count, distance_km, total_amount, payment_status, package_description, assigned_expert_id, cancel_reason_code, delivered_at, created_at";

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
