import { anchorPrice } from "@/lib/price";
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
export function ServiceProductCard({
  service,
  onAdd,
  onViewDetail,
  unavailable = false,
  unavailableLabel,
}: {
  service: ProductCardService;
  onAdd: () => void;
  onViewDetail?: () => void;
  /** Greys out the card and blocks navigation / ADD. */
  unavailable?: boolean;
  /** Optional custom badge copy (e.g. the reason from Command Center). */
  unavailableLabel?: string | null;
}) {
  const t = useT();
  const price = Number(service.price);
  const was = service.strikePrice ?? anchorPrice(price);

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
            src={service.imageUrl || fallbackImage}
            alt={service.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
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

