import { useQuery } from "@tanstack/react-query";
import { ImageIcon, Store as StoreIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Store and product photos live in a private bucket, so every thumbnail is a
 * short-lived signed URL (never getPublicUrl).
 */
export function StoreImage({
  path,
  bucket = "product-images",
  className = "",
  variant = "product",
  alt = "",
}: {
  path: string | null;
  bucket?: string;
  className?: string;
  variant?: "product" | "store";
  alt?: string;
}) {
  const { data } = useQuery({
    queryKey: ["store-image", bucket, path],
    enabled: Boolean(path),
    staleTime: 45 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path!, 60 * 60);
      return data?.signedUrl ?? null;
    },
  });

  if (!path || !data) {
    const Fallback = variant === "store" ? StoreIcon : ImageIcon;
    return (
      <div
        className={`flex items-center justify-center rounded-[18px] bg-muted text-muted-foreground ${className}`}
      >
        <Fallback className="h-5 w-5" />
      </div>
    );
  }

  return (
    <img
      src={data}
      alt={alt}
      loading="lazy"
      className={`rounded-[18px] object-cover ${className}`}
    />
  );
}
