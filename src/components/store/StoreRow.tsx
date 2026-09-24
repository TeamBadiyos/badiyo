import { ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { StoreImage } from "./StoreImage";
import { ProductCard } from "./ProductCard";
import { StoreRating } from "./StoreRating";
import { formatDistance, isStoreOpen, type PublicProduct, type PublicStore } from "@/lib/store";

/** One shop: header line + its products, each addable to the cart. */
export function StoreRow({
  store,
  km,
  products,
  onOpen,
}: {
  store: PublicStore;
  km: number | null;
  products: PublicProduct[];
  onOpen: () => void;
}) {
  const t = useT();
  const closed = !isStoreOpen(store);
  const dist = formatDistance(km);
  const storeRef = { id: store.id, name: store.store_name ?? null };
  return (
    <div
      className={
        "rounded-[18px] border border-border bg-card p-3 shadow-card-m " + (closed ? "opacity-60 grayscale" : "")
      }
    >
      <div className="flex w-full items-center gap-3">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <StoreImage path={store.photo_url} variant="store" alt={store.store_name ?? ""} className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">{store.store_name ?? "—"}</p>
            <div className="mt-0.5 flex items-center gap-2">
              {dist && <span className="text-[11px] font-semibold text-muted-foreground">{dist}</span>}
              <span
                className={
                  "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                  (closed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")
                }
              >
                {closed ? t("store.closed") : t("store.open")}
              </span>
              <StoreRating rating={store.rating} />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex shrink-0 items-center gap-0.5 self-start rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary"
        >
          {t("store.viewAll")}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="-mx-3 mt-3 snap-x snap-mandatory overflow-x-auto scroll-px-3 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2.5">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} store={storeRef} closed={closed} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}
