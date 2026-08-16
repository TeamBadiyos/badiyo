import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { anchorPrice } from "@/lib/price";

type Service = {
  id: string;
  icon: string | null;
  duration_label: string;
  duration_minutes: number;
  subtitle: string | null;
  price: number;
};

async function fetchServices(): Promise<Service[]> {
  const { data, error } = await supabase
    .from("service_catalogue_config")
    .select("id, icon, duration_label, duration_minutes, subtitle, price, display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Service[];
}

export function SearchResultsScreen({
  query,
  onBack,
  onBookService,
}: {
  query: string;
  onBack: () => void;
  onBookService: (s: {
    duration_label: string;
    duration_minutes: number;
    price: number;
    subtitle: string | null;
    icon: string | null;
  }) => void;
}) {
  const { data: services = [], isLoading } = useQuery({
    queryKey: ["services"],
    queryFn: fetchServices,
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
            <div className="flex flex-col gap-3">
              {results.map((s) => (
                <article
                  key={s.id}
                  className="surface-tint flex items-center gap-4 rounded-[18px] border border-border p-4 shadow-card-m"
                >
                  <div className="icon-disc flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="text-base font-bold text-foreground">{s.duration_label}</div>
                    {s.subtitle && (
                      <div className="text-xs text-muted-foreground">{s.subtitle}</div>
                    )}
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-[17px] font-bold tracking-[-0.02em] text-primary">
                        Rs {Number(s.price)}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground line-through">
                        Rs {anchorPrice(Number(s.price))}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      onBookService({
                        duration_label: s.duration_label,
                        duration_minutes: Number(s.duration_minutes),
                        price: Number(s.price),
                        subtitle: s.subtitle,
                        icon: s.icon,
                      })
                    }
                    className="shrink-0 rounded-[12px] bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition active:scale-[0.98]"
                  >
                    Book Now
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
