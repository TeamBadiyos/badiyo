import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";
import { ServiceProductCard } from "./home/ServiceProductCard";
import { fetchSegmentServices } from "@/lib/segments";
import { useT } from "@/i18n";
import { matchesAllWords, searchWords, useNearbyCatalog, ProductGridOverlay } from "./store/storeCatalog";
import { ProductCard } from "./store/ProductCard";
import { useIsInternalTester } from "@/lib/store";
import { useServiceState } from "@/lib/serviceHours";
import { useState } from "react";
import { fetchAvailability, isUnavailable, unavailableReason } from "@/lib/availability";

export function SearchResultsScreen({
  query,
  onBack,
  onBookService,
  onQuickBook,
  onOpenStore,
}: {
  query: string;
  onBack: () => void;
  onBookService: (s: import("./SlotSelectionScreen").SelectedService) => void;
  onQuickBook?: (s: import("./SlotSelectionScreen").SelectedService) => void;
  onOpenStore?: (s: import("@/lib/store").PublicStore) => void;
}) {
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["segment_services"],
    queryFn: fetchSegmentServices,
  });

  const { data: availability } = useQuery({
    queryKey: ["availability_overrides"],
    queryFn: fetchAvailability,
    // Short cache + background refresh: the screen opens instantly and the
    // list corrects itself a moment later instead of blocking on the network.
    staleTime: 30_000,
  });

  const t = useT();
  const selectService = (s: typeof services[number]): import("./SlotSelectionScreen").SelectedService => ({
    id: s.id,
    service_category_id: s.service_category_id,
    duration_label: s.duration_label,
    duration_minutes: Number(s.duration_minutes),
    price: Number(s.price),
    subtitle: s.subtitle,
    icon: s.icon,
    segment_id: s.segment_id,
    service_name: s.service_name,
    strikethrough_price: s.strikethrough_price,
    pricing_type: s.pricing_type,
    image_url: s.image_url,
    gallery_urls: s.gallery_urls,
    video_url: s.video_url,
    description: s.description,
    inclusions: s.inclusions,
    exclusions: s.exclusions,
    task_types: s.task_types ?? [],
  });

  const words = searchWords(query);
  const results = services.filter((s) =>
    matchesAllWords(`${s.service_name ?? ""} ${s.duration_label ?? ""} ${s.subtitle ?? ""} ${s.description ?? ""}`, words),
  );
  const { data: storeState } = useServiceState("store");
  const { data: isTester = false } = useIsInternalTester();
  const storeUnlocked = storeState?.status === "live" || isTester;
  const { items: catalog, loading: catLoading } = useNearbyCatalog(null);
  const productHits = !storeUnlocked || words.length === 0 ? [] : catalog.filter((i) =>
    matchesAllWords(
      `${i.product.name} ${i.product.description ?? ""} ${i.product.unit ?? ""} ${i.product.product_category ?? ""} ${i.store.store_name ?? ""} ${i.store.category_name ?? ""}`,
      words,
    ),
  );
  const [allProducts, setAllProducts] = useState(false);

  return (
    <main className="min-h-screen w-full bg-background pb-10">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-[14px] border border-border bg-card px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="truncate text-sm text-foreground">{query || "All services"}</span>
          </div>
        </header>

        <section className="mt-5">
          {productHits.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">{t("search.products")} ({productHits.length})</p>
                {productHits.length > 6 && (
                  <button type="button" onClick={() => setAllProducts(true)} className="text-sm font-bold text-primary">
                    {t("home.seeAll")} →
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {productHits.slice(0, 6).map((i) => (
                  <div key={i.product.id} className="min-w-0">
                    <ProductCard product={i.product} store={{ id: i.store.id, name: i.store.store_name }} closed={i.closed} fluid onOpen={onOpenStore ? () => onOpenStore(i.store) : undefined} />
                    <p className="mt-1 truncate text-[10px] font-semibold text-muted-foreground">{i.store.store_name}</p>
                  </div>
                ))}
              </div>
              {results.length > 0 && <p className="mt-5 text-sm font-bold text-foreground">{t("search.services")}</p>}
            </div>
          )}
          {allProducts && <ProductGridOverlay title={query} items={productHits} onClose={() => setAllProducts(false)} onOpenStore={onOpenStore} />}
          {isLoading || (storeUnlocked && catLoading) ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : results.length === 0 && productHits.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-[18px] border border-dashed border-border bg-card px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Search className="h-7 w-7 text-primary" />
              </div>
              <p className="mt-4 text-base font-bold text-foreground">
                Kuch nahi mila "{query}"
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Dusra word try karein jaise "cleaning", "milk" ya "atta".
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {results.map((s) => (
                <ServiceProductCard
                  key={s.id}
                  service={{
                    name: s.service_name || s.duration_label,
                    imageUrl: s.image_url,
                    strikePrice: s.strikethrough_price,
                    price: Number(s.price),
                    durationMinutes: s.duration_minutes,
                  }}
                  unavailable={
                    isUnavailable(availability, "item", s.id) ||
                    isUnavailable(availability, "category", s.service_category_id)
                  }
                  unavailableLabel={
                    unavailableReason(availability, "item", s.id) ||
                    unavailableReason(availability, "category", s.service_category_id)
                  }
                  onViewDetail={() => onBookService(selectService(s))}
                  onAdd={() => {
                    toast(t("home.addedToBooking", { name: s.service_name || s.duration_label }));
                    onQuickBook?.(selectService(s));
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
