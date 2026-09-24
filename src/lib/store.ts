/**
 * Read-only Store data for the customer app.
 *
 * Customers never touch `merchants` / `products` directly — those hold phone,
 * GST, bank, commission and raw stock data. Two postgres-owned views expose
 * only the safe columns, and both are granted to `authenticated` only.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { haversineKm } from "@/lib/addressSearch";

export type PublicStore = {
  id: string;
  store_name: string | null;
  store_category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  zone_id: string | null;
  photo_url: string | null;
  short_address: string | null;
  lat: number | null;
  lng: number | null;
  is_accepting_orders: boolean | null;
  /** Manual switch ON *and* inside today's IST store timings. Computed server-side. */
  is_open_now: boolean | null;
  rating: number | null;
};

/** Fallback used when ops_settings has no `store_max_radius_km` row. */
export const DEFAULT_STORE_RADIUS_KM = 5;

export type PublicProduct = {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  unit: string | null;
  price: number;
  mrp: number | null;
  in_stock: boolean;
  product_category: string | null;
};

export type StoreCategory = {
  id: string;
  name: string;
  slug: string;
  rank: number;
};

export async function fetchPublicStores(): Promise<PublicStore[]> {
  const { data, error } = await supabase
    .from("public_stores")
    .select(
      "id, store_name, store_category_id, category_name, category_slug, zone_id, photo_url, short_address, lat, lng, is_accepting_orders, is_open_now, rating",
    );
  if (error) throw error;
  return (data ?? []) as PublicStore[];
}

/**
 * How far from the customer a shop may be before it is hidden.
 * `ops_settings` is staff-only, so this comes through a read-only RPC.
 */
export async function fetchStoreRadiusKm(): Promise<number> {
  const { data, error } = await supabase.rpc("store_max_radius_km");
  if (error || data == null) return DEFAULT_STORE_RADIUS_KM;
  const km = Number(data);
  return Number.isFinite(km) && km > 0 ? km : DEFAULT_STORE_RADIUS_KM;
}

export function useStoreRadiusKm() {
  return useQuery({
    queryKey: ["store_max_radius_km"],
    queryFn: fetchStoreRadiusKm,
    staleTime: 30 * 60_000,
  });
}

export async function fetchStoreProducts(merchantId: string): Promise<PublicProduct[]> {
  const { data, error } = await supabase
    .from("public_products")
    .select("id, merchant_id, name, description, photo_url, unit, price, mrp, in_stock, product_category")
    .eq("merchant_id", merchantId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PublicProduct[];
}

export async function fetchStoreCategories(): Promise<StoreCategory[]> {
  const { data, error } = await supabase
    .from("store_categories")
    .select("id, name, slug, rank")
    .eq("is_active", true)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StoreCategory[];
}

/** True when the signed-in phone number is on the internal testers list. */
export async function fetchIsInternalTester(): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_internal_tester");
  if (error) return false;
  return Boolean(data);
}

export function useIsInternalTester() {
  return useQuery({
    queryKey: ["is_internal_tester"],
    queryFn: fetchIsInternalTester,
    staleTime: 10 * 60_000,
  });
}

export function useStoreList() {
  return useQuery({
    queryKey: ["public_stores"],
    queryFn: fetchPublicStores,
    staleTime: 2 * 60_000,
  });
}

export function useStoreCategories() {
  return useQuery({
    queryKey: ["store_categories"],
    queryFn: fetchStoreCategories,
    staleTime: 10 * 60_000,
  });
}

export function useStoreProducts(merchantId: string | null) {
  return useQuery({
    queryKey: ["public_products", merchantId],
    queryFn: () => fetchStoreProducts(merchantId!),
    enabled: Boolean(merchantId),
    staleTime: 60_000,
  });
}

/** Straight-line distance from the customer to a store, in km. */
export function storeDistanceKm(
  store: PublicStore,
  from: { lat: number; lng: number } | null,
): number | null {
  if (!from || store.lat == null || store.lng == null) return null;
  return haversineKm(from, { lat: Number(store.lat), lng: Number(store.lng) });
}

export function formatDistance(km: number | null): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
