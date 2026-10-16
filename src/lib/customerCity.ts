import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The customer's active city (from their selected address). Module-level so
 * non-React fetchers (slots, Book Now, payment gates) can read it too.
 * null = unknown yet → server falls back to the default city.
 */
const CITY_KEY = "bdy_last_city_id";
// Restored from the device on launch so cached content keyed by city is found on the first frame.
let currentCityId: string | null = (() => {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(CITY_KEY) || null; } catch { return null; }
})();
const listeners = new Set<() => void>();

export function getCustomerCityId(): string | null {
  return currentCityId;
}

export function setCustomerCityId(id: string | null) {
  if (id === currentCityId) return;
  currentCityId = id;
  try {
    if (id) window.localStorage.setItem(CITY_KEY, id);
    else window.localStorage.removeItem(CITY_KEY);
  } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useCustomerCityId(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => currentCityId,
    () => null,
  );
}

/** Adds `_city_id` to RPC args when the city is known. */
export function withCity<T extends Record<string, unknown>>(args: T): T & { _city_id?: string } {
  return currentCityId ? { ...args, _city_id: currentCityId } : args;
}

export type CityResolution = {
  cityId: string | null;
  /** True only when the address has GPS and lies outside every active city. */
  outside: boolean;
  lat: number | null;
  lng: number | null;
};

/** Resolve the active address's city from its GPS pin and publish it app-wide. */
export function useResolveAddressCity(addressId: string | null | undefined) {
  const q = useQuery({
    queryKey: ["address_city", addressId],
    enabled: !!addressId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<CityResolution> => {
      const { data: addr } = await supabase
        .from("addresses")
        .select("latitude, longitude")
        .eq("id", addressId!)
        .maybeSingle();
      const lat = addr?.latitude ?? null;
      const lng = addr?.longitude ?? null;
      if (lat == null || lng == null) return { cityId: null, outside: false, lat, lng };
      const { data, error } = await supabase.rpc("app_city_for_location", { _lat: lat, _lng: lng });
      if (error) return { cityId: null, outside: false, lat, lng }; // fail-open
      const cityId = (data as string | null) ?? null;
      return { cityId, outside: !cityId, lat, lng };
    },
  });
  useEffect(() => {
    if (q.data) setCustomerCityId(q.data.cityId);
  }, [q.data]);
  return q.data ?? null;
}
