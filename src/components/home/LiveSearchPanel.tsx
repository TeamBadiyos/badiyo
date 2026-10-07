import { useNearbyCatalog, matchesAllWords, searchWords } from "@/components/store/storeCatalog";
import { StoreImage } from "@/components/store/StoreImage";
import type { PublicStore } from "@/lib/store";
import { sizedImageUrl } from "@/lib/serviceImage";
import type { SegmentService } from "@/lib/segments";

/** Instant results shown under the Home search box while typing. */
export function LiveSearchPanel({
  query,
  coords,
  services,
  storeUnlocked,
  onOpenStore,
  onOpenService,
}: {
  query: string;
  coords: { lat: number; lng: number } | null;
  services: SegmentService[];
  storeUnlocked: boolean;
  onOpenStore: (s: PublicStore) => void;
  onOpenService: (s: SegmentService) => void;
}) {
  const words = searchWords(query);
  const { items } = useNearbyCatalog(storeUnlocked ? coords : null);
  const svc = services
    .filter((s) =>
      matchesAllWords(`${s.service_name ?? ""} ${s.duration_label ?? ""} ${s.subtitle ?? ""} ${s.description ?? ""}`, words),
    )
    .slice(0, 6);
  const prods = !storeUnlocked
    ? []
    : items
        .filter((i) =>
          matchesAllWords(
            `${i.product.name} ${i.product.description ?? ""} ${i.product.unit ?? ""} ${i.product.product_category ?? ""} ${i.store.store_name ?? ""} ${i.store.category_name ?? ""}`,
            words,
          ),
        )
        .slice(0, 10);

  if (svc.length === 0 && prods.length === 0) {
    return (
      <div className="mt-2 rounded-[14px] border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        Kuch nahi mila "{query}"
      </div>
    );
  }

  const row = "flex w-full items-center gap-3 px-3 py-2 text-left active:bg-muted";
  return (
    <div className="mt-2 overflow-hidden rounded-[14px] border border-border bg-card shadow-card-m">
      {prods.map((i) => (
        <button key={i.product.id} type="button" className={row} onClick={() => onOpenStore(i.store)}>
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[10px] bg-muted">
            <StoreImage path={i.product.photo_url} variant="product" alt="" className="h-full w-full !rounded-[10px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">{i.product.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{i.store.store_name}</p>
          </div>
          <span className="shrink-0 text-sm font-bold text-primary">Rs {Number(i.product.price).toFixed(0)}</span>
        </button>
      ))}
      {svc.map((s) => (
        <button key={s.id} type="button" className={row} onClick={() => onOpenService(s)}>
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-[10px] bg-muted">
            {s.image_url && <img src={sizedImageUrl(s.image_url, 120) ?? undefined} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">{s.service_name || s.duration_label}</p>
            <p className="truncate text-[11px] text-muted-foreground">{s.duration_label}</p>
          </div>
          <span className="shrink-0 text-sm font-bold text-primary">Rs {Number(s.price).toFixed(0)}</span>
        </button>
      ))}
    </div>
  );
}
