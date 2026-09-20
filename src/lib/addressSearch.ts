/**
 * Forward address search for the address picker.
 *
 * Google Places is blocked on this project's key, so search runs on the
 * Geocoding API through /api/public/geocode-search. If that route cannot be
 * reached (offline from our server in the native shell), the Maps JS Geocoder
 * already loaded for the map is used as a fallback.
 */
import { supabase } from "@/integrations/supabase/client";
import { loadMapsScript } from "./googleMapsLoader";
import { isNativeShell, REMOTE_SERVER_FN_ORIGIN } from "./nativeServerFn";

export type AddressSearchResult = {
  title: string;
  address: string;
  lat: number;
  lng: number;
  pincode: string | null;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function viaHttpRoute(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSearchResult[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session");
  const base = isNativeShell() ? REMOTE_SERVER_FN_ORIGIN : "";
  const res = await fetch(`${base}/api/public/geocode-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, lat: near?.lat, lng: near?.lng }),
    credentials: "omit",
  });
  const body = (await res.json().catch(() => ({}))) as {
    results?: AddressSearchResult[];
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.results ?? [];
}

async function viaBrowserGeocoder(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSearchResult[]> {
  await loadMapsScript();
  const g = (window as any).google;
  if (!g?.maps?.Geocoder) throw new Error("Maps SDK unavailable");
  const geocoder = new g.maps.Geocoder();
  const request: Record<string, unknown> = {
    address: query,
    region: "in",
    componentRestrictions: { country: "IN" },
  };
  if (near) {
    request.bounds = new g.maps.LatLngBounds(
      { lat: near.lat - 0.35, lng: near.lng - 0.35 },
      { lat: near.lat + 0.35, lng: near.lng + 0.35 },
    );
  }
  const { results } = await geocoder.geocode(request);
  return (results ?? []).slice(0, 6).map((r: any) => {
    const pick = (types: string[]) =>
      r.address_components.find((c: any) => types.some((t) => c.types.includes(t)))?.long_name ?? null;
    return {
      title:
        pick(["point_of_interest", "premise", "sublocality", "sublocality_level_1", "neighborhood", "route"]) ??
        pick(["locality"]) ??
        String(r.formatted_address).split(",")[0],
      address: r.formatted_address,
      lat: r.geometry.location.lat(),
      lng: r.geometry.location.lng(),
      pincode: pick(["postal_code"]),
    } as AddressSearchResult;
  });
}

export async function searchAddresses(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSearchResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    return await withTimeout(viaHttpRoute(q, near), 8000, "address search");
  } catch (e) {
    console.error("[address] search failed (http):", (e as Error)?.message);
  }
  return await withTimeout(viaBrowserGeocoder(q, near), 8000, "address search");
}
