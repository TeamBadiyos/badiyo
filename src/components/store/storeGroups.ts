import { isStoreOpen, storeDistanceKm, type PublicProduct, type PublicStore, type StoreCategory, type StorePreview } from "@/lib/store";

export type RankedStore = { store: PublicStore; km: number | null; products: PublicProduct[] };
export type StoreCategoryGroup = { category: StoreCategory; stores: RankedStore[] };

const byDistance = (a: RankedStore, b: RankedStore) => {
  if (a.km == null && b.km == null) return 0;
  if (a.km == null) return 1;
  if (b.km == null) return -1;
  return a.km - b.km;
};

/** In-range shops with ≥1 in-stock item, grouped by category in rank order; open first, then closed, each by distance. */
export function buildStoreGroups(
  stores: PublicStore[],
  categories: StoreCategory[],
  previews: Record<string, StorePreview>,
  coords: { lat: number; lng: number } | null,
  radiusKm: number,
): StoreCategoryGroup[] {
  const ranked: RankedStore[] = stores
    .map((s) => ({ store: s, km: storeDistanceKm(s, coords), products: previews[s.id]?.items ?? [] }))
    .filter((r) => (r.km == null || r.km <= radiusKm) && (previews[r.store.id]?.inStockCount ?? 0) > 0);
  return categories
    .map((category) => {
      const inCat = ranked.filter((r) => r.store.store_category_id === category.id);
      const open = inCat.filter((r) => isStoreOpen(r.store)).sort(byDistance);
      const closed = inCat.filter((r) => !isStoreOpen(r.store)).sort(byDistance);
      return { category, stores: [...open, ...closed] };
    })
    .filter((g) => g.stores.length > 0);
}
