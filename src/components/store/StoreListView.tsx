import { useMemo } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { SectionHeading } from "@/components/SectionHeading";
import {
  DEFAULT_STORE_RADIUS_KM,
  useStoreCategories,
  useStoreList,
  useStorePreviewProducts,
  useStoreRadiusKm,
  type PublicStore,
} from "@/lib/store";
import { StoreRow } from "./StoreRow";
import { StoreOrderingBar } from "./StoreOrderingBar";
import { buildStoreGroups, type StoreCategoryGroup } from "./storeGroups";

type Coords = { lat: number; lng: number } | null;

/** Store tab: shops grouped by category, 3 nearest per category, one row per shop. */
export function StoreListView({
  coords,
  onOpenStore,
  onOpenCategory,
}: {
  coords: Coords;
  onOpenStore: (store: PublicStore) => void;
  onOpenCategory: (group: StoreCategoryGroup) => void;
}) {
  const t = useT();
  const { data: categories = [] } = useStoreCategories();
  const { data: stores = [], isLoading } = useStoreList();
  const { data: radiusKm = DEFAULT_STORE_RADIUS_KM } = useStoreRadiusKm();
  const ids = useMemo(() => stores.map((s) => s.id), [stores]);
  const { data: previews, isLoading: loadingPreviews } = useStorePreviewProducts(ids);

  const groups = useMemo(
    () => buildStoreGroups(stores, categories, previews ?? {}, coords, radiusKm),
    [stores, categories, previews, coords, radiusKm],
  );

  const loading = isLoading || (ids.length > 0 && loadingPreviews);

  return (
    <section className="mt-4 pb-20">
      {loading ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-6 rounded-[18px] border border-dashed border-border bg-card px-6 py-12 text-center">
          <p className="text-sm font-bold text-foreground">{t("store.emptyStores")}</p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.category.id} className="mt-5 first:mt-0">
            <SectionHeading>{g.category.name}</SectionHeading>
            <ul className="mt-3 space-y-3">
              {g.stores.slice(0, 3).map((r) => (
                <li key={r.store.id}>
                  <StoreRow store={r.store} km={r.km} products={r.products} onOpen={() => onOpenStore(r.store)} />
                </li>
              ))}
            </ul>
            {g.stores.length > 3 && (
              <button
                type="button"
                onClick={() => onOpenCategory(g)}
                className="mt-3 flex w-full items-center justify-center gap-1 rounded-[18px] border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-bold text-primary"
              >
                {t("store.seeAllIn", { name: g.category.name })}
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        ))
      )}
      <StoreOrderingBar aboveNav />
    </section>
  );
}
