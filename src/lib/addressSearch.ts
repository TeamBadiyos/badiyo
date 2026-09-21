/**
 * Address / place search for the customer app.
 *
 * Primary path: Google Places (New) autocomplete through our own server route
 * (/api/public/places-search), which returns the business or landmark name,
 * its area line and the distance from the user. Tapping a result fetches the
 * exact coordinates with one Place Details call, reusing the same Places
 * session token so the whole search bills as a single session.
 *
 * Fallback: if Places is unavailable, the Geocoding route (and finally the
 * Maps JS geocoder already loaded for the map) answers the same shape.
 */
import { supabase } from "@/integrations/supabase/client";
import { loadMapsScript } from "./googleMapsLoader";
import { isNativeShell, REMOTE_SERVER_FN_ORIGIN } from "./nativeServerFn";

export type AddressSuggestion = {
  /** Stable key for lists. */
  id: string;
  /** Bold line — business / landmark / road name. */
  title: string;
  /** Muted second line — area, city. */
  area: string;
  /** Straight-line distance from the user, in km. */
  distanceKm: number | null;
  /** Set for Places results; resolved lazily on tap. */
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  pincode: string | null;
};

export type ResolvedPlace = {
  lat: number;
  lng: number;
  address: string;
  pincode: string | null;
};

/** Legacy shape kept for callers that only need coordinates. */
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

// ---------------------------------------------------------------- session

let sessionToken: string | null = null;

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** One token per search session: every keystroke bills as one session. */
export function currentSessionToken(): string {
  if (!sessionToken) sessionToken = uuid();
  return sessionToken;
}

/** Call after a result is picked (or the search box is cleared). */
export function endSearchSession() {
  sessionToken = null;
}

// ------------------------------------------------------------------ cache

const suggestionCache = new Map<string, AddressSuggestion[]>();
const detailCache = new Map<string, ResolvedPlace>();

function cacheKey(query: string, near?: { lat: number; lng: number }) {
  const n = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : "-";
  return `${query.toLowerCase()}|${n}`;
}

// ------------------------------------------------------------------- http

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function base() {
  return isNativeShell() ? REMOTE_SERVER_FN_ORIGIN : "";
}

async function placesAutocomplete(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSuggestion[]> {
  const res = await fetch(`${base()}/api/public/places-search`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      action: "autocomplete",
      query,
      lat: near?.lat,
      lng: near?.lng,
      sessionToken: currentSessionToken(),
    }),
    credentials: "omit",
  });
  const body = (await res.json().catch(() => ({}))) as {
    suggestions?: Array<{
      placeId: string;
      title: string;
      area: string;
      distanceMeters: number | null;
    }>;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return (body.suggestions ?? []).map((s) => ({
    id: s.placeId,
    title: s.title,
    area: s.area,
    distanceKm: s.distanceMeters == null ? null : s.distanceMeters / 1000,
    placeId: s.placeId,
    lat: null,
    lng: null,
    pincode: null,
  }));
}

async function geocodeSearch(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSuggestion[]> {
  const res = await fetch(`${base()}/api/public/geocode-search`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ query, lat: near?.lat, lng: near?.lng }),
    credentials: "omit",
  });
  const body = (await res.json().catch(() => ({}))) as {
    results?: AddressSearchResult[];
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return (body.results ?? []).map((r, i) => ({
    id: `geo-${r.lat},${r.lng},${i}`,
    title: r.title,
    area: r.address,
    distanceKm: near ? haversineKm(near, { lat: r.lat, lng: r.lng }) : null,
    placeId: null,
    lat: r.lat,
    lng: r.lng,
    pincode: r.pincode,
  }));
}

async function browserGeocoder(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSuggestion[]> {
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
  return (results ?? []).slice(0, 6).map((r: any, i: number) => {
    const pick = (types: string[]) =>
      r.address_components.find((c: any) => types.some((t: string) => c.types.includes(t)))
        ?.long_name ?? null;
    const lat = r.geometry.location.lat();
    const lng = r.geometry.location.lng();
    return {
      id: `map-${lat},${lng},${i}`,
      title:
        pick(["point_of_interest", "premise", "sublocality", "neighborhood", "route"]) ??
        pick(["locality"]) ??
        String(r.formatted_address).split(",")[0],
      area: r.formatted_address,
      distanceKm: near ? haversineKm(near, { lat, lng }) : null,
      placeId: null,
      lat,
      lng,
      pincode: pick(["postal_code"]),
    } as AddressSuggestion;
  });
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ------------------------------------------------------------------- api

/** Places first, Geocoding second, Maps SDK last. Minimum 3 characters. */
export async function searchPlaceSuggestions(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const key = cacheKey(q, near);
  const cached = suggestionCache.get(key);
  if (cached) return cached;

  let out: AddressSuggestion[] | null = null;
  try {
    out = await withTimeout(placesAutocomplete(q, near), 8000, "place search");
  } catch (e) {
    console.error("[address] places search failed:", (e as Error)?.message);
  }
  if (!out || out.length === 0) {
    try {
      const geo = await withTimeout(geocodeSearch(q, near), 8000, "address search");
      if (geo.length > 0 || !out) out = geo;
    } catch (e) {
      console.error("[address] geocode search failed:", (e as Error)?.message);
    }
  }
  if (!out) out = await withTimeout(browserGeocoder(q, near), 8000, "address search");

  suggestionCache.set(key, out);
  if (suggestionCache.size > 60) suggestionCache.clear();
  return out;
}

/** Resolve a tapped suggestion to coordinates (one Place Details call). */
export async function resolveSuggestion(s: AddressSuggestion): Promise<ResolvedPlace> {
  if (s.lat != null && s.lng != null) {
    return { lat: s.lat, lng: s.lng, address: s.area, pincode: s.pincode };
  }
  if (!s.placeId) throw new Error("This place has no location.");
  const cached = detailCache.get(s.placeId);
  if (cached) return cached;

  const res = await fetch(`${base()}/api/public/places-search`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      action: "details",
      placeId: s.placeId,
      sessionToken: currentSessionToken(),
    }),
    credentials: "omit",
  });
  const body = (await res.json().catch(() => ({}))) as {
    lat?: number;
    lng?: number;
    address?: string;
    pincode?: string | null;
    error?: string;
  };
  if (!res.ok || body.lat == null || body.lng == null) {
    throw new Error(body.error ?? "Place lookup failed");
  }
  const out: ResolvedPlace = {
    lat: body.lat,
    lng: body.lng,
    address: body.address ?? s.area,
    pincode: body.pincode ?? null,
  };
  detailCache.set(s.placeId, out);
  endSearchSession();
  return out;
}

/** Back-compat helper: returns fully resolved results. */
export async function searchAddresses(
  query: string,
  near?: { lat: number; lng: number },
): Promise<AddressSearchResult[]> {
  const list = await searchPlaceSuggestions(query, near);
  const resolved = await Promise.all(
    list.map(async (s) => {
      try {
        const r = await resolveSuggestion(s);
        return { title: s.title, address: r.address, lat: r.lat, lng: r.lng, pincode: r.pincode };
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter(Boolean) as AddressSearchResult[];
}
