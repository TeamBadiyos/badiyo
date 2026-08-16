/**
 * service-images is a private Storage bucket, so getPublicUrl() does not work.
 * A public cacheable proxy streams the RLS-approved object instead.
 */
const PROXY = "https://badiyos.com/api/public/service-image?path=";

/** Resolve a stored service image reference into a loadable URL. */
export function serviceImageUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  // Already-proxied or absolute non-storage URLs pass through unchanged.
  if (value.startsWith(PROXY)) return value;
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
