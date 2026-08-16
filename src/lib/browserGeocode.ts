/**
 * Browser-side reverse geocoding fallback.
 *
 * The primary path is the `reverseGeocode` server function (server key, no
 * referrer restrictions). In the Capacitor build that call crosses to the
 * deployed server, and if the installed APK bundle was built from a different
 * commit than the deployed server, the server-function id no longer resolves
 * and the request fails — the pin moves but the address never fills in.
 *
 * The Maps JS SDK is already loaded for the picker and the app's https origin
 * is on the browser key's referrer allowlist, so we can geocode client-side as
 * a safety net.
 */
import { loadMapsScript } from "./googleMapsLoader";

export type BrowserGeocodeResult = {
  formatted_address: string;
  area: string | null;
  city: string | null;
};

export async function browserReverseGeocode(
  location: { lat: number; lng: number },
): Promise<BrowserGeocodeResult> {
  await loadMapsScript();
  const g = (window as any).google;
  if (!g?.maps?.Geocoder) throw new Error("Maps SDK unavailable");
  const geocoder = new g.maps.Geocoder();
  const { results } = await geocoder.geocode({ location });
  if (!results?.length) throw new Error("No results");
  const top = results[0];
  const pick = (types: string[]) =>
    top.address_components.find((c: any) =>
      types.some((t) => c.types.includes(t)),
    )?.long_name ?? null;
  return {
    formatted_address: top.formatted_address,
    area:
      pick(["sublocality", "sublocality_level_1", "neighborhood"]) ??
      pick(["locality"]),
    city: pick(["locality"]) ?? pick(["administrative_area_level_2"]),
  };
}
