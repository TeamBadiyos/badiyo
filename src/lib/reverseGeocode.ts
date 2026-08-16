/**
 * Reverse geocoding for the address picker, resilient in the native shell.
 *
 * Order of attempts:
 *  1. HTTP route /api/public/reverse-geocode (absolute URL on native) — stable
 *     URL + plain JSON, so it does not depend on server-function RPC ids
 *     matching between the installed APK bundle and the deployed server.
 *  2. Maps JS Geocoder inside the WebView (the SDK is already loaded for the
 *     map) — covers the case where the app is offline from our server but the
 *     Google browser key still works.
 *
 * Every attempt is time-boxed so the UI can never get stuck on "Finding
 * address…".
 */
import { supabase } from "@/integrations/supabase/client";
import { browserReverseGeocode } from "./browserGeocode";
import { isNativeShell, REMOTE_SERVER_FN_ORIGIN } from "./nativeServerFn";

export type GeocodeResult = {
  formatted_address: string;
  area: string | null;
  city: string | null;
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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

async function viaHttpRoute(location: { lat: number; lng: number }): Promise<GeocodeResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No session");
  const base = isNativeShell() ? REMOTE_SERVER_FN_ORIGIN : "";
  const res = await fetch(`${base}/api/public/reverse-geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(location),
    credentials: "omit",
  });
  const body = (await res.json().catch(() => ({}))) as Partial<GeocodeResult> & { error?: string };
  if (!res.ok || !body.formatted_address) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return {
    formatted_address: body.formatted_address,
    area: body.area ?? null,
    city: body.city ?? null,
  };
}

export type GeocodeOutcome =
  | { ok: true; result: GeocodeResult; via: "http" | "browser" }
  | { ok: false; error: string };

export async function resolveAddress(location: {
  lat: number;
  lng: number;
}): Promise<GeocodeOutcome> {
  const errors: string[] = [];
  try {
    const result = await withTimeout(viaHttpRoute(location), 8000, "reverse-geocode");
    console.info("[address] reverse geocode ok (http):", result.formatted_address);
    return { ok: true, result, via: "http" };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    errors.push(`http: ${msg}`);
    console.error("[address] reverse geocode failed (http):", msg);
  }
  try {
    const result = await withTimeout(browserReverseGeocode(location), 8000, "maps-js geocode");
    console.info("[address] reverse geocode ok (browser):", result.formatted_address);
    return { ok: true, result, via: "browser" };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    errors.push(`browser: ${msg}`);
    console.error("[address] reverse geocode failed (browser):", msg);
  }
  return { ok: false, error: errors.join(" | ") };
}
