import { memo, useState } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { anchorPrice } from "@/lib/price";
import { sizedImageUrl } from "@/lib/serviceImage";
import { useT } from "@/i18n";

import fallbackImage from "@/assets/expert-house-cleaning.jpg";

export type ProductCardService = {
  name: string;
  price: number;
  imageUrl?: string | null;
  /** Duration services show minutes inline; flat-priced items omit it. */
  durationMinutes?: number | null;
  /** Explicit "was" price from the catalogue; falls back to the anchor value. */
  strikePrice?: number | null;
};

/**
 * Blinkit-style compact product card: square image, 2-line name,
 * price with strikethrough anchor, and a small outlined ADD button.
 */
function ServiceProductCardBase({
  service,
  onAdd,
  onViewDetail,
  unavailable = false,
  unavailableLabel,
  statusBadge,
}: {
  service: ProductCardService;
  onAdd: () => void;
  onViewDetail?: () => void;
  /** Greys out the card and blocks navigation / ADD. */
  unavailable?: boolean;
  /** Optional custom badge copy (e.g. the reason from Command Center). */
  unavailableLabel?: string | null;
  /** Service-level status ribbon (e.g. "Coming soon") shown in the image corner. */
  statusBadge?: string | null;
}) {
  const t = useT();
  const price = Number(service.price);
  const was = service.strikePrice ?? anchorPrice(price);

  const [loaded, setLoaded] = useState(false);
  // Cards render at ~170px wide; ask for a 2x variant, never the full-size file.
  const src = sizedImageUrl(service.imageUrl, 360) || fallbackImage;

  const blocked = () => {
    toast(t("home.unavailableToast"));
  };

  return (
    <article
      aria-disabled={unavailable || undefined}
      className={`surface-tint flex w-full min-w-0 flex-col rounded-[18px] border border-border p-2 shadow-card-m ${
        unavailable ? "cursor-not-allowed opacity-60 grayscale" : "cursor-pointer"
      }`}
      onClick={unavailable ? blocked : onViewDetail}
    >
      <div className="relative">
        <div className="brand-grade aspect-square w-full overflow-hidden rounded-[14px] bg-muted">
          <img
            src={src}
            alt={service.name}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition-opacity duration-200 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
        {statusBadge && !unavailable ? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-[14px] bg-gradient-to-b from-foreground/35 to-transparent"
            />
            <span className="absolute left-1 top-1 flex max-w-[92%] items-center gap-1 rounded-full border border-[#E5A50A]/40 bg-card/85 px-1.5 py-0.5 text-[9px] font-extrabold leading-tight text-[#B8830A] shadow-sm backdrop-blur-[2px]">
              <Clock className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{statusBadge}</span>
            </span>
          </>
        ) : null}
        {unavailable ? (
          <span className="absolute left-1 top-1 rounded-[8px] bg-foreground/75 px-1.5 py-0.5 text-[9px] font-bold leading-tight text-background">
            {unavailableLabel || t("home.unavailableBadge")}
          </span>
        ) : null}
        <button
          type="button"
          disabled={unavailable}
          onClick={(e) => {
            e.stopPropagation();
            if (unavailable) {
              blocked();
              return;
            }
            onAdd();
          }}
          className={`absolute -bottom-2 right-1 rounded-[10px] border border-primary bg-card px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.02em] text-primary shadow-card-m transition active:scale-[0.96] ${
            unavailable ? "border-muted-foreground/40 text-muted-foreground" : ""
          }`}
        >
          {t("home.add")}
        </button>
      </div>

      <p className="mt-3 line-clamp-2 text-[12px] font-bold leading-tight text-foreground">
        {service.name}
      </p>

      <div className="mt-1 flex flex-col">
        <span className="text-[10px] font-semibold leading-none text-muted-foreground line-through">
          {t("common.rupees", { amount: was })}
        </span>
        <span className="text-[15px] font-bold leading-tight tracking-[-0.02em] text-primary">
          {t("common.rupees", { amount: price })}
        </span>
      </div>
    </article>
  );
}


/**
 * Memoised: home renders dozens of these, and unrelated state changes
 * (search text, sheets, toasts) must not re-render the whole grid.
 */
export const ServiceProductCard = memo(ServiceProductCardBase);
