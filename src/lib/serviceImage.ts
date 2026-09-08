/**
 * service-images is a private Storage bucket, so getPublicUrl() does not work.
 * The app serves it through its own cached route (`/api/public/service-image`),
 * which streams the object with an immutable one-year cache. The old external
 * proxy on badiyos.com answered in 1.5-3.5s with a 1-hour cache, which made
 * every screen with pictures feel slow.
 */
const PROXY = "/api/public/service-image?path=";
const LEGACY_PROXY = "https://badiyos.com/api/public/service-image?path=";

/** Resolve a stored service image reference into a loadable URL. */
export function serviceImageUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.startsWith(PROXY)) return value;
  // Migrate any previously-stored legacy proxy URL onto the fast route.
  if (value.startsWith(LEGACY_PROXY)) return PROXY + value.slice(LEGACY_PROXY.length);
  if (/^(data:|blob:)/i.test(value)) return value;

  let path = value;
  if (/^https?:\/\//i.test(value)) {
    // Extract the object path out of a Supabase storage URL if one was stored.
    const match = value.match(/\/service-images\/(.+)$/);
    if (!match) return value;
    path = decodeURIComponent(match[1].split("?")[0]);
  }
  path = path.replace(/^\/+/, "").replace(/^service-images\//, "");
  return PROXY + encodeURIComponent(path);
}

/** Map a list of stored references through {@link serviceImageUrl}. */
export function serviceImageUrls(raws?: (string | null)[] | null): string[] {
  return (raws ?? [])
    .map((r) => serviceImageUrl(r))
    .filter((u): u is string => Boolean(u));
}

/**
 * Ask the image route for a variant no wider than the box it renders in.
 * Non-proxied URLs (bundled fallbacks, data URLs) pass through untouched.
 */
export function sizedImageUrl(url?: string | null, width?: number): string | null {
  if (!url) return null;
  if (!width || !url.startsWith(PROXY)) return url;
  return `${url}&w=${Math.round(width)}`;
}
