import { useMemo, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { SectionHeading } from "@/components/SectionHeading";
import { StoreImage } from "./StoreImage";
import { StoreRating } from "./StoreRating";
import {
  DEFAULT_STORE_RADIUS_KM,
  formatDistance,
  isStoreOpen,
  storeDistanceKm,
  useStoreCategories,
  useStoreList,
  useStoreRadiusKm,
  type PublicStore,
} from "@/lib/store";

type Coords = { lat: number; lng: number } | null;

/** Store tab: category chips + nearest-first shop list. Closed shops sink to the bottom. */
export function StoreListView({
  coords,
  onOpenStore,
}: {
  coords: Coords;
  onOpenStore: (store: PublicStore) => void;
}) {
  const t = useT();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { data: categories = [] } = useStoreCategories();
  const { data: stores = [], isLoading } = useStoreList();
  const { data: radiusKm = DEFAULT_STORE_RADIUS_KM } = useStoreRadiusKm();

  /**
   * Shops the customer may actually be served by: same zone when we know it,
   * otherwise everything inside the configured radius. Anything further away
   * is dropped entirely rather than shown as an unreachable option.
   */
  const inRange = useMemo(
    () =>
      stores
        .map((s) => ({ store: s, km: storeDistanceKm(s, coords) }))
        .filter(({ km }) => km == null || km <= radiusKm),
    [stores, coords, radiusKm],
  );

  const rows = useMemo(() => {
    const filtered = inRange.filter(
      ({ store }) => !activeCategory || store.store_category_id === activeCategory,
    );

    const byDistance = (a: { km: number | null }, b: { km: number | null }) => {
      if (a.km == null && b.km == null) return 0;
      if (a.km == null) return 1;
      if (b.km == null) return -1;
      return a.km - b.km;
    };

    const open = filtered.filter((r) => isStoreOpen(r.store)).sort(byDistance);
    const closed = filtered.filter((r) => !isStoreOpen(r.store)).sort(byDistance);
    return [...open, ...closed];
  }, [inRange, activeCategory]);

  // Only offer chips for categories that actually have a nearby shop behind them.
  const usedCategoryIds = new Set(
    inRange.map(({ store }) => store.store_category_id).filter(Boolean),
  );
  const chips = categories.filter((c) => usedCategoryIds.has(c.id));

  return (
    <section className="mt-4">
      {chips.length > 0 && (
        <nav className="-mx-5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-2">
            {[{ id: null as string | null, name: t("store.allCategories") }, ...chips].map((c) => {
              const active = c.id === activeCategory;
              return (
                <button
                  key={c.id ?? "all"}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  aria-current={active ? "true" : undefined}
                  className={
                    "shrink-0 rounded-full px-4 py-2 text-sm font-bold transition active:scale-[0.98] " +
                    (active
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-foreground")
                  }
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <SectionHeading className="mt-5">{t("store.nearbyTitle")}</SectionHeading>

      {isLoading ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-[18px] border border-dashed border-border bg-card px-6 py-12 text-center">
          <p className="text-sm font-bold text-foreground">{t("store.emptyStores")}</p>
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map(({ store, km }) => {
            const closed = !store.is_accepting_orders;
            return (
              <li key={store.id}>
                <button
                  type="button"
                  onClick={() => onOpenStore(store)}
                  className={
                    "flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-3 text-left shadow-card-m transition active:scale-[0.99] " +
                    (closed ? "opacity-60" : "")
                  }
                >
                  <StoreImage
                    path={store.photo_url}
                    variant="store"
                    alt={store.store_name ?? ""}
                    className="h-14 w-14 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">
                      {store.store_name ?? "—"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[store.category_name, store.short_address].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                          (closed
                            ? "bg-muted text-muted-foreground"
                            : "bg-primary/10 text-primary")
                        }
                      >
                        {closed ? t("store.closed") : t("store.open")}
                      </span>
                      {formatDistance(km) && (
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {formatDistance(km)}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
