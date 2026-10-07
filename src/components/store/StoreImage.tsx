import { useState } from "react";
import { ImageIcon, Store as StoreIcon } from "lucide-react";

/**
 * Store and product photos load straight from the app's cached image route
 * (lightweight WebP copies, one-year cache) — no per-photo signed-URL call.
 */
export function StoreImage({
  path,
  className = "",
  variant = "product",
  alt = "",
}: {
  path: string | null;
  bucket?: string;
  className?: string;
  variant?: "product" | "store" | "category";
  alt?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const Fallback = variant === "store" ? StoreIcon : ImageIcon;

  if (!path || failed) {
    return (
      <div className={`flex items-center justify-center rounded-[18px] bg-muted text-muted-foreground ${className}`}>
        <Fallback className="h-5 w-5" />
      </div>
    );
  }

  const src = /^https?:\/\//i.test(path)
    ? path
    : `/api/public/store-image?kind=${variant}&path=${encodeURIComponent(path)}`;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={`rounded-[18px] object-cover transition-opacity duration-200 ${loaded ? "bg-transparent opacity-100" : "bg-muted opacity-60"} ${className}`}
    />
  );
}
