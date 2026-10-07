import { useBackHandler } from "@/lib/backHandler";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/i18n";
import { SectionHeading } from "@/components/SectionHeading";
import {
  DEFAULT_STORE_RADIUS_KM,
  formatDistance,
  isStoreOpen,
  storeDistanceKm,
  useStoreCategories,
  useStoreList,
  useStorePreviewProducts,
  useStoreRadiusKm,
  type PublicProduct,
  type PublicStore,
  type StoreCategory,
} from "@/lib/store";
import { ProductCard } from "./ProductCard";
import { StoreImage } from "./StoreImage";

type Coords = { lat: number; lng: number } | null;
export type CatalogItem = { product: PublicProduct; store: PublicStore; km: number | null; closed: boolean };
export type CatalogShelf = { category: StoreCategory; items: CatalogItem[] };

/** Lowercase, strip punctuation, split into words. */
export function searchWords(q: string): string[] {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s.]/gu, " ").split(/\s+/).filter(Boolean);
}
/** Every typed word must appear somewhere in the text (any order). */
export function matchesAllWords(text: string, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * All products from nearby shops, flattened. Open shops first, then nearest,
 * in-stock first. Shelves follow store_categories.rank (set in Command Center).
 */
export function useNearbyCatalog(coords: Coords) {
  const { data: categories = [] } = useStoreCategories();
  const { data: stores = [], isLoading } = useStoreList();
  const { data: radiusKm = DEFAULT_STORE_RADIUS_KM } = useStoreRadiusKm();
  const ids = useMemo(() => stores.map((s) => s.id), [stores]);
  const { data: previews, isLoading: lp } = useStorePreviewProducts(ids);

  const items = useMemo<CatalogItem[]>(() => {
    const out: CatalogItem[] = [];
    for (const s of stores) {
      const km = storeDistanceKm(s, coords);
      if (km != null && km > radiusKm) continue;
      const closed = !isStoreOpen(s);
      for (const p of previews?.[s.id]?.items ?? []) out.push({ product: p, store: s, km, closed });
    }
    return out.sort(
      (a, b) =>
        Number(a.closed) - Number(b.closed) ||
        Number(!a.product.in_stock) - Number(!b.product.in_stock) ||
        (a.km ?? 99) - (b.km ?? 99),
    );
  }, [stores, previews, coords, radiusKm]);

  const shelves = useMemo<CatalogShelf[]>(
    () =>
      categories
        .map((category) => ({ category, items: items.filter((i) => i.store.store_category_id === category.id) }))
        .filter((s) => s.items.length > 0),
    [categories, items],
  );

  return { items, shelves, loading: isLoading || (ids.length > 0 && lp) };
}

function CatalogCard({
  item,
  fluid,
  onOpenStore,
}: {
  item: CatalogItem;
  fluid?: boolean;
  onOpenStore?: (s: PublicStore) => void;
}) {
  const dist = formatDistance(item.km);
  return (
    <div className={fluid ? "min-w-0" : "w-[30vw] max-w-[132px] shrink-0"}>
      <ProductCard
        product={item.product}
        store={{ id: item.store.id, name: item.store.store_name }}
        closed={item.closed}
        fluid={fluid}
        onOpen={onOpenStore ? () => onOpenStore(item.store) : undefined}
      />
      <p className="mt-1 truncate px-0.5 text-[10px] font-semibold text-muted-foreground">
        {item.store.store_name ?? ""}
        {dist ? ` • ${dist}` : ""}
      </p>
    </div>
  );
}

/** Full-screen grid of products (one category, or search results). */
export function ProductGridOverlay({
  title,
  items,
  onClose,
  onOpenStore,
}: {
  title: string;
  items: CatalogItem[];
  onClose: () => void;
  onOpenStore?: (s: PublicStore) => void;
}) {
  useBackHandler(true, () => onClose());
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background momentum-scroll">
      <div className="mx-auto w-full max-w-md px-4 pb-32">
        <header
          className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-background px-4 pb-3"
          style={{ paddingTop: "calc(var(--app-safe-top, 0px) + 12px)" }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.back")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-foreground">{title}</p>
            <p className="text-[11px] text-muted-foreground">{t("store.itemsCount", { n: String(items.length) })}</p>
          </div>
        </header>
        <div className="grid grid-cols-2 gap-3">
          {items.map((i) => (
            <CatalogCard key={i.product.id} item={i} fluid onOpenStore={onOpenStore} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Blinkit-style category tiles; tap opens every product in that category. */
export function StoreCategoryGrid({ coords }: { coords: Coords }) {
  const t = useT();
  const { shelves } = useNearbyCatalog(coords);
  const [open, setOpen] = useState<CatalogShelf | null>(null);
  if (shelves.length === 0) return null;
  return (
    <>
      <SectionHeading>{t("store.shopByCategory")}</SectionHeading>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {shelves.map((s) => {
          const photo = s.items.find((i) => i.product.photo_url)?.product;
          return (
            <button
              key={s.category.id}
              type="button"
              onClick={() => setOpen(s)}
              className="flex flex-col items-center gap-1 rounded-[14px] bg-primary/5 p-1.5 text-center active:scale-95"
            >
              <div className="h-14 w-full overflow-hidden rounded-[10px] bg-card">
                <StoreImage path={photo?.photo_url ?? null} variant="product" alt={s.category.name} className="h-full w-full" />
              </div>
              <span className="line-clamp-2 text-[10px] font-bold leading-tight text-foreground">
                {s.category.name}
              </span>
            </button>
          );
        })}
      </div>
      {open && <ProductGridOverlay title={open.category.name} items={open.items} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Horizontal product rails per category, in Command Center rank order. */
export function StoreShelves({
  coords,
  max = 10,
  onOpenStore,
}: {
  coords: Coords;
  max?: number;
  onOpenStore?: (s: PublicStore) => void;
}) {
  const t = useT();
  const { shelves } = useNearbyCatalog(coords);
  const [open, setOpen] = useState<CatalogShelf | null>(null);
  if (shelves.length === 0) return null;
  return (
    <>
      {shelves.map((s) => (
        <section key={s.category.id} className="mt-5">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading>{s.category.name}</SectionHeading>
            <button type="button" onClick={() => setOpen(s)} className="text-sm font-bold text-primary">
              {t("home.seeAll")} →
            </button>
          </div>
          <div className="-mx-5 mt-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-2.5">
              {s.items.slice(0, max).map((i) => (
                <CatalogCard key={i.product.id} item={i} onOpenStore={onOpenStore} />
              ))}
            </div>
          </div>
        </section>
      ))}
      {open && (
        <ProductGridOverlay
          title={open.category.name}
          items={open.items}
          onClose={() => setOpen(null)}
          onOpenStore={
            onOpenStore
              ? (st) => {
                  setOpen(null);
                  onOpenStore(st);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
