import { Star } from "lucide-react";
import { useT } from "@/i18n";

/**
 * A shop's rating. There is no rating source yet, so `rating` is normally
 * null — in that case we show a "New" badge rather than inventing stars.
 */
export function StoreRating({ rating }: { rating: number | null }) {
  const t = useT();
  const value = rating == null ? null : Number(rating);

  if (value == null || !Number.isFinite(value)) {
    return (
      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">
        {t("store.newStore")}
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-foreground">
      <Star className="h-3 w-3 fill-current text-primary" />
      {value.toFixed(1)}
    </span>
  );
}
