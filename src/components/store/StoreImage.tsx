import { useEffect, useState } from "react";
import { ImageIcon, Store as StoreIcon } from "lucide-react";

/**
 * Catalog photos live in the public `catalog-images` bucket, so they load
 * straight from the CDN — no proxy, no signed URLs. Lists/grids use the
 * lightweight WebP thumbnail; full-size views use the original.
 *
 * Fallback chain:
 *   thumb → original → legacy /api/public/store-image proxy → placeholder
 *   full  → legacy proxy → placeholder
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

  if (!path) {
    return (
      <div className={`flex items-center justify-center rounded-[18px] bg-muted text-muted-foreground ${className}`}>
        <Fallback className="h-5 w-5" />
      </div>
    );
  }

  // External URLs pass through untouched.
  const external = /^https?:\/\//i.test(path);
  const clean = path.replace(/^\/+/, "");
  const sources: string[] = external
    ? [path]
    : size === "full"
      ? [
          `${CATALOG_BASE}/${clean}`,
          `/api/public/store-image?kind=${variant}&path=${encodeURIComponent(clean)}`,
        ]
      : [
          `${CATALOG_BASE}/_thumbs/${clean}.webp`,
          `${CATALOG_BASE}/${clean}`,
          `/api/public/store-image?kind=${variant}&path=${encodeURIComponent(clean)}`,
        ];

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
