import { useEffect, useState } from "react";
import { ImageIcon, Store as StoreIcon } from "lucide-react";

/**
 * Catalog photos live in the public `catalog-images` bucket, so they load
 * straight from the CDN — no proxy, no signed URLs. Lists/grids use the
 * lightweight WebP thumbnail; full-size views use the original.
 *
 * Fallback chain:
 *   thumb → original → placeholder
 *   full  → placeholder
 */
const CATALOG_BASE = "https://api.badiyos.com/storage/v1/object/public/catalog-images";

export function StoreImage({
  path,
  className = "",
  variant = "product",
  alt = "",
  size = "thumb",
}: {
  path: string | null;
  bucket?: string;
  className?: string;
  variant?: "product" | "store" | "category";
  alt?: string;
  /** "thumb" for lists/grids, "full" for full-size previews. */
  size?: "thumb" | "full";
}) {
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const Fallback = variant === "store" ? StoreIcon : ImageIcon;

  useEffect(() => {
    setStep(0);
    setLoaded(false);
  }, [path, size]);

  // Give the lightweight thumbnail time to arrive on slow networks before
  // falling back to the heavier original. Full-size views have no fallback.
  useEffect(() => {
    if (loaded || step !== 0 || !path || size === "full") return;
    if (/^https?:\/\//i.test(path) && !path.startsWith(`${CATALOG_BASE}/`)) return;
    const t = setTimeout(() => setStep((s) => (s === 0 ? 1 : s)), 3000);
    return () => clearTimeout(t);
  }, [loaded, step, path, size]);

  if (!path) {
    return (
      <div className={`flex items-center justify-center rounded-[18px] bg-muted text-muted-foreground ${className}`}>
        <Fallback className="h-5 w-5" />
      </div>
    );
  }

  // Catalog photos use pre-made WebP thumbnails for lists and originals for
  // full-size views, preserving the original path's URL encoding.
  const external = /^https?:\/\//i.test(path);
  const catalogPrefix = `${CATALOG_BASE}/`;
  const isCatalogUrl = external && path.startsWith(catalogPrefix);
  const clean = (isCatalogUrl ? path.slice(catalogPrefix.length) : path).replace(/^\/+/, "");
  const thumb = clean.startsWith("_thumbs/") ? clean : `_thumbs/${clean}.webp`;
  const sources: string[] = external && !isCatalogUrl
    ? [path]
    : size === "full"
      ? [`${CATALOG_BASE}/${clean}`]
      : [`${CATALOG_BASE}/${thumb}`, `${CATALOG_BASE}/${clean}`];

  if (step >= sources.length) {
    return (
      <div className={`flex items-center justify-center rounded-[18px] bg-muted text-muted-foreground ${className}`}>
        <Fallback className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={sources[step]}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setStep((s) => s + 1)}
      className={`rounded-[18px] object-cover transition-opacity duration-200 ${loaded ? "bg-transparent opacity-100" : "bg-muted opacity-60"} ${className}`}
    />
  );
}
