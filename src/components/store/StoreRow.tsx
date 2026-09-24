import { ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { StoreImage } from "./StoreImage";
import { StoreRating } from "./StoreRating";
import { formatDistance, isStoreOpen, type PublicProduct, type PublicStore } from "@/lib/store";

/** One shop: header line + 3 product cards + "View all" tile. */
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
  return (
    <div
      className={
        "rounded-[18px] border border-border bg-card p-3 shadow-card-m " + (closed ? "opacity-60 grayscale" : "")
      }
    >
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-left">
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

      <div className="-mx-3 mt-3 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2.5">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={onOpen}
              className={"w-[104px] shrink-0 text-left " + (p.in_stock ? "" : "opacity-50")}
            >
              <StoreImage path={p.photo_url} variant="product" alt={p.name} className="h-[104px] w-[104px]" />
              <p className="mt-1.5 line-clamp-2 text-xs font-bold leading-tight text-foreground">{p.name}</p>
              {p.unit && <p className="text-[11px] text-muted-foreground">{p.unit}</p>}
              <p className="mt-0.5 text-sm font-extrabold text-foreground">₹{Number(p.price).toFixed(0)}</p>
            </button>
          ))}
          <button
            type="button"
            onClick={onOpen}
            className="flex h-[104px] w-[88px] shrink-0 flex-col items-center justify-center gap-1 rounded-[18px] bg-primary/10 text-xs font-bold text-primary"
          >
            <ChevronRight className="h-5 w-5" />
            {t("store.viewAll")}
          </button>
        </div>
      </div>
    </div>
  );
}
