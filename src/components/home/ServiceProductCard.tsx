import { anchorPrice } from "@/lib/price";
import { useT } from "@/i18n";

import fallbackImage from "@/assets/expert-house-cleaning.jpg";

export type ProductCardService = {
  name: string;
  price: number;
  imageUrl?: string | null;
  /** Duration services show minutes inline; flat-priced items omit it. */
  durationMinutes?: number | null;
};

/**
 * Blinkit-style compact product card: square image, 2-line name,
 * price with strikethrough anchor, and a small outlined ADD button.
 */
export function ServiceProductCard({
  service,
  onAdd,
}: {
  service: ProductCardService;
  onAdd: () => void;
}) {
  const t = useT();
  const price = Number(service.price);
  const was = anchorPrice(price);

  return (
    <article className="surface-tint flex w-full min-w-0 flex-col rounded-[18px] border border-border p-2 shadow-card-m">
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
        <button
          onClick={onAdd}
          className="absolute -bottom-2 right-1 rounded-[10px] border border-primary bg-card px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.02em] text-primary shadow-card-m transition active:scale-[0.96]"
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
