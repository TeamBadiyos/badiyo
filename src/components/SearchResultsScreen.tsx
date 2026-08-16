import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { ServiceProductCard } from "./home/ServiceProductCard";
import { fetchSegmentServices } from "@/lib/segments";

export function SearchResultsScreen({
  query,
  onBack,
  onBookService,
}: {
  query: string;
  onBack: () => void;
  onBookService: (s: import("./SlotSelectionScreen").SelectedService) => void;
}) {
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["segment_services"],
    queryFn: fetchSegmentServices,
  });


  const q = query.trim().toLowerCase();
  const results = services.filter((s) => {
    const hay = `${s.duration_label ?? ""} ${s.subtitle ?? ""}`.toLowerCase();
    return q.length === 0 ? true : hay.includes(q);
  });

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
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : results.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-[18px] border border-dashed border-border bg-card px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Search className="h-7 w-7 text-primary" />
              </div>
              <p className="mt-4 text-base font-bold text-foreground">
                No services found for "{query}"
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different keyword like "cleaning" or "dishes".
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
                  onAdd={() =>
                    onBookService({
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

                    })
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
