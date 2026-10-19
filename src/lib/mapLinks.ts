// Detects pasted Google Maps links and Plus Codes in the location search.
type LatLng = { lat: number; lng: number };

const ok = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;

/** Pull coordinates out of a full Google Maps URL (no network). */
export function coordsFromMapsUrl(raw: string): LatLng | null {
  const s = decodeURIComponent(raw);
  const pats = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, // exact place pin
    /[?&](?:q|query|ll|center|destination|daddr|saddr)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\/(?:place|search|dir)\/(-?\d+\.\d+),\s*\+?(-?\d+\.\d+)/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const r = ok(Number(m[1]), Number(m[2]));
      if (r) return r;
    }
  }
  return null;
}

/** Text place name inside a maps URL (?q=Some+Place or /place/Some+Place/). */
export function placeTextFromMapsUrl(raw: string): string | null {
  const s = decodeURIComponent(raw.replace(/\+/g, " "));
  const m = s.match(/[?&](?:q|query)=([^&]+)/) ?? s.match(/\/place\/([^/@?]+)/);
  return m ? m[1].trim() : null;
}

export function findMapsUrl(input: string): string | null {
  const m = input.match(
    /https?:\/\/(?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[a-z.]+|google\.[a-z.]+\/maps|g\.co\/kgs)[^\s]*/i,
  );
  return m ? m[0] : null;
}

export const isShortMapsUrl = (u: string) => /maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs/i.test(u);

// ------------------------------------------------------------ Plus Codes
const ALPHA = "23456789CFGHJMPQRVWX";

function decodeFull(code: string): LatLng | null {
  const c = code.replace("+", "").replace(/0+$/, "").toUpperCase();
  let lat = -90, lng = -180, res = 400;
  const pairs = Math.min(c.length, 10);
  for (let i = 0; i < pairs; i += 2) {
    res /= 20;
    const a = ALPHA.indexOf(c[i]), b = ALPHA.indexOf(c[i + 1] ?? "2");
    if (a < 0 || b < 0) return null;
    lat += a * res;
    lng += b * res;
  }
  let latRes = res, lngRes = res;
  for (let i = 10; i < c.length; i++) {
    const d = ALPHA.indexOf(c[i]);
    if (d < 0) return null;
    latRes /= 5; lngRes /= 4;
    lat += Math.floor(d / 4) * latRes;
    lng += (d % 4) * lngRes;
  }
  return ok(lat + latRes / 2, lng + lngRes / 2);
}

/** Find a Plus Code in the text. Returns the code and any locality after it. */
export function findPlusCode(input: string): { code: string; rest: string } | null {
  const m = input.trim().match(/^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3})\s*,?\s*(.*)$/i);
  return m ? { code: m[1].toUpperCase(), rest: m[2].trim() } : null;
}

/** Decode a full or short Plus Code; short codes use `ref` (map centre / locality). */
export function decodePlusCode(code: string, ref: LatLng): LatLng | null {
  const sep = code.indexOf("+");
  if (sep === 8) return decodeFull(code);
  if (sep < 2 || sep % 2) return null;
  const missing = 8 - sep;
  const res = Math.pow(20, 2 - missing / 2);
  const round = (v: number) => Math.floor(v / res) * res;
  // Build prefix from the reference point.
  const refCode = encodePrefix(round(ref.lat + 90) - 90 + res / 2, round(ref.lng + 180) - 180 + res / 2, missing);
  const full = decodeFull(refCode + code);
  if (!full) return null;
  // Pick the nearest of neighbouring cells.
  let { lat, lng } = full;
  const half = res / 2;
  if (ref.lat + half < lat && lat - res >= -90) lat -= res;
  else if (ref.lat - half > lat && lat + res <= 90) lat += res;
  if (ref.lng + half < lng) lng -= res;
  else if (ref.lng - half > lng) lng += res;
  return ok(lat, lng);
}

function encodePrefix(lat: number, lng: number, len: number): string {
  let la = lat + 90, ln = lng + 180, out = "", res = 400;
  for (let i = 0; i < len; i += 2) {
    res /= 20;
    const a = Math.floor(la / res), b = Math.floor(ln / res);
    out += ALPHA[a] + ALPHA[b];
    la -= a * res; ln -= b * res;
  }
  return out;
}
