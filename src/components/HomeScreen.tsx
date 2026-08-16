import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { ChevronDown, ChevronRight, Clock, Gift, Home, MapPin, Mic, Search, Sparkles, User, Wind, type LucideIcon } from "lucide-react";
import { BadiyoLogo } from "./BadiyoLogo";
import { BottomNav } from "./BottomNav";
import { LocationPickerSheet, type SavedAddress } from "./LocationPickerSheet";
import { ServicesBar } from "./home/ServicesBar";
import { WhatsIncludedSheet } from "./WhatsIncludedSheet";
import { supabase } from "@/integrations/supabase/client";
import { useAvatarUrl } from "@/lib/useAvatarUrl";
import { fetchSegmentServices, fetchSegments, type Segment, type SegmentService } from "@/lib/segments";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/en";

import expertHouse from "@/assets/expert-house-cleaning.jpg";
import expertDusting from "@/assets/expert-dusting.jpg";
import expertDishes from "@/assets/expert-dishes.jpg";

const ICON_MAP: Record<string, LucideIcon> = {
  clock: Clock,
  "vacuum-cleaner": Wind,
  sparkles: Sparkles,
  gift: Gift,
  home: Home,
};

function Icon({ name, className }: { name?: string | null; className?: string }) {
  const Cmp = (name && ICON_MAP[name]) || Sparkles;
  return <Cmp className={className} />;
}

import { fetchSections } from "@/lib/homeData";


const EXPERT_TILES: { image: string; labelKey: TranslationKey; slug: string }[] = [
  { image: expertHouse, labelKey: "home.tile.houseCleaning", slug: "house-cleaning" },
  { image: expertDusting, labelKey: "home.tile.dusting", slug: "dusting-wiping" },
  { image: expertDishes, labelKey: "home.tile.dishes", slug: "cleaning-dishes" },
];

function ExpertTiles({ onOpenTask }: { onOpenTask: (slug: string) => void }) {
  const t = useT();
  return (
    <div className="mt-5 grid grid-cols-3 gap-4">
      {EXPERT_TILES.map((tile) => (
        <button
          type="button"
          key={tile.labelKey}
          onClick={() => onOpenTask(tile.slug)}
          className="flex flex-col text-left transition active:scale-[0.98]"
        >
          <div className="aspect-square overflow-hidden rounded-[16px] bg-muted">
            <img
              src={tile.image}
              alt={t(tile.labelKey)}
              width={512}
              height={512}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
          <p className="mt-2 w-full text-center text-xs font-semibold text-foreground leading-tight">
            {t(tile.labelKey)}
          </p>
        </button>
      ))}
    </div>
  );
}

export type BookServicePayload = {
  duration_label: string;
  duration_minutes: number;
  price: number;
  subtitle: string | null;
  icon: string | null;
  segment_id: string | null;
  segment_name: string | null;
};

function toPayload(s: SegmentService, segment?: Segment | null): BookServicePayload {
  return {
    duration_label: s.duration_label,
    duration_minutes: Number(s.duration_minutes),
    price: Number(s.price),
    subtitle: s.subtitle,
    icon: s.icon,
    segment_id: s.segment_id ?? segment?.id ?? null,
    segment_name: segment?.name ?? null,
  };
}

/** Full-width booking card used by the existing Home Cleaning flow. */
function ServiceCard({ s, onBook }: { s: SegmentService; onBook: () => void }) {
  const t = useT();
  return (
    <article className="flex items-center gap-4 rounded-[18px] border border-border bg-card p-4 shadow-sm">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icon name={s.icon} className="h-5 w-5 text-primary" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-base font-bold text-foreground">{s.duration_label}</div>
        {s.subtitle && <div className="text-xs text-muted-foreground">{s.subtitle}</div>}
        <div className="text-sm font-bold text-primary">
          {t("common.rupees", { amount: Number(s.price) })}
        </div>
      </div>
      <button
        onClick={onBook}
        className="shrink-0 rounded-[12px] bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition active:scale-[0.98]"
      >
        {t("home.bookNow")}
      </button>
    </article>
  );
}

/** Compact card used inside the 3-up service grids (All tab + segment page). */
function ServiceMiniCard({ s, onBook }: { s: SegmentService; onBook: () => void }) {
  const t = useT();
  return (
    <article className="flex h-[190px] w-full min-w-0 flex-col rounded-[18px] border border-border bg-card p-3 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icon name={s.icon} className="h-[18px] w-[18px] text-primary" />
      </div>
      <div className="mt-2 line-clamp-2 text-[13px] font-bold leading-tight text-foreground">
        {s.duration_label}
      </div>
      {s.subtitle && (
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
          {s.subtitle}
        </div>
      )}
      <div className="mt-1 text-[13px] font-bold text-primary">
        {t("common.rupees", { amount: Number(s.price) })}
      </div>
      <button
        onClick={onBook}
        className="mt-auto w-full rounded-[12px] bg-primary px-2 py-2 text-[11px] font-bold text-primary-foreground transition active:scale-[0.98]"
      >
        {t("home.bookNow")}
      </button>
    </article>
  );
}


export function HomeScreen({
  onBookService,
  onOpenProfile,
  onOpenRewards,
  onOpenOrders,
  onSearch,
}: {
  onBookService?: (service: BookServicePayload) => void;
  onOpenProfile?: () => void;
  onOpenRewards?: () => void;
  onOpenOrders?: () => void;
  onSearch?: (query: string) => void;
}) {
  const { data: segments = [] } = useQuery({ queryKey: ["segments"], queryFn: fetchSegments });
  const { data: services = [] } = useQuery({
    queryKey: ["segment_services"],
    queryFn: fetchSegmentServices,
  });
  const { data: sections = [] } = useQuery({
    queryKey: ["homepage_sections"],
    queryFn: fetchSections,
  });
  const { data: avatarUrl } = useAvatarUrl();
  const t = useT();

  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["segments"] }),
      queryClient.refetchQueries({ queryKey: ["segment_services"] }),
      queryClient.refetchQueries({ queryKey: ["homepage_sections"] }),
      queryClient.refetchQueries({ queryKey: ["users_total_coins"] }),
    ]);
  });


  const searchBar = sections.find((s) => s.section_type === "search_bar");
  const promo = sections.find((s) => s.section_type === "promo_banner");

  const searchPlaceholder =
    searchBar?.payload?.placeholder ?? t("home.searchPlaceholder");

  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [activeAddress, setActiveAddress] = useState<SavedAddress | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [includedSlug, setIncludedSlug] = useState<string | null>(null);
  const [includedOpen, setIncludedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("addresses")
        .select("id, label, full_address, area, city, is_default")
        .eq("user_id", uid)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled && data && data.length > 0) {
        setActiveAddress(data[0] as SavedAddress);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const locationLabel = activeAddress?.area ?? activeAddress?.label ?? "Lahoti Compound";

  const activeSegment = segments.find((s) => s.id === activeSegmentId) ?? null;
  const servicesFor = (segment: Segment) =>
    services.filter((s) => s.segment_id === segment.id);

  const cleanSegment =
    activeSegment ??
    segments.find((s) => s.slug?.toLowerCase().includes("clean")) ??
    segments[0] ??
    null;
  const tileService = cleanSegment ? servicesFor(cleanSegment)[0] ?? null : null;
  const bookFromSheet = () => {
    setIncludedOpen(false);
    if (tileService) onBookService?.(toPayload(tileService, cleanSegment));
  };
  const openIncluded = (slug: string) => {
    setIncludedSlug(slug);
    setIncludedOpen(true);
  };

  return (
    <main className="min-h-screen w-full bg-background pb-28 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-2">
        {/* Header */}
        <header
          className="bleed-safe-top sticky top-0 z-30 -mx-5 flex items-center justify-between gap-3 bg-background px-5 pb-4"
          style={{ "--bleed-top-extra": "16px" } as React.CSSProperties}
        >
          <BadiyoLogo variant="green" className="h-7 w-auto" />
          <button
            onClick={() => setLocationSheetOpen(true)}
            className="flex items-center gap-1 text-sm font-semibold text-foreground max-w-[55%]"
          >
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{locationLabel}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <button
            onClick={onOpenProfile}
            aria-label={t("common.profile")}
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-primary/60 bg-card"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={t("common.profile")}
                className="h-full w-full object-cover"
                loading="eager"
                decoding="async"
              />
            ) : (
              <User className="h-5 w-5 text-primary" />
            )}
          </button>
        </header>

        {/* Search bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch?.(searchQuery.trim());
          }}
          className="mt-5 flex items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3 shadow-sm"
        >
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
            placeholder={searchPlaceholder}
          />
          <button type="button" aria-label={t("home.voiceSearch")}>
            <Mic className="h-5 w-5 text-muted-foreground" />
          </button>
        </form>

        {/* Services bar (segment tabs) */}
        <ServicesBar
          segments={segments}
          activeSegmentId={activeSegmentId}
          onSelect={setActiveSegmentId}
        />

        {activeSegment ? (
          <SegmentView
            segment={activeSegment}
            services={servicesFor(activeSegment)}
            onBookService={onBookService}
            onOpenTask={openIncluded}
          />
        ) : (
          <div className="mt-2">
            {segments.map((segment) => {
              const items = servicesFor(segment).slice(0, 3);
              if (items.length === 0) return null;
              return (
                <section key={segment.id} className="mt-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-extrabold tracking-tight text-foreground">
                      {segment.name}
                    </h2>
                    <button
                      onClick={() => setActiveSegmentId(segment.id)}
                      className="flex items-center gap-0.5 text-sm font-bold text-primary"
                    >
                      {t("home.seeAll")}
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2.5">
                    {items.map((s) => (
                      <ServiceMiniCard
                        key={s.id}
                        s={s}
                        onBook={() => onBookService?.(toPayload(s, segment))}
                      />
                    ))}
                  </div>

                </section>
              );
            })}

            {/* Expert tiles */}
            <h2 className="mt-8 text-xl font-extrabold tracking-tight text-foreground">
              {t("home.oneExpert")}
            </h2>
            <ExpertTiles onOpenTask={openIncluded} />
          </div>
        )}

        {/* Promo banner */}
        {promo && (
          <button
            onClick={onOpenRewards}
            className="mt-10 flex w-full items-center gap-3 rounded-[18px] bg-primary/10 p-4 text-left transition active:scale-[0.98]"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/20">
              <Icon name={promo.payload?.icon} className="h-5 w-5 text-primary" />
            </div>
            <p className="flex-1 text-sm font-semibold text-foreground leading-snug">
              {promo.payload?.text}
            </p>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              →
            </span>
          </button>
        )}
      </div>

      <BottomNav
        activeKey="home"
        onHome={() => setActiveSegmentId(null)}
        onOrders={onOpenOrders ?? (() => {})}
        onRewards={onOpenRewards ?? (() => {})}
      />

      <WhatsIncludedSheet
        open={includedOpen}
        segmentId={cleanSegment?.id ?? null}
        taskSlug={includedSlug}
        onClose={() => setIncludedOpen(false)}
        onSchedule={tileService ? bookFromSheet : undefined}
        onBookInstant={tileService ? bookFromSheet : undefined}
      />

      <LocationPickerSheet
        open={locationSheetOpen}
        activeId={activeAddress?.id ?? null}
        onClose={() => setLocationSheetOpen(false)}
        onSelect={(a) => {
          setActiveAddress(a);
          setLocationSheetOpen(false);
        }}
      />
    </main>
  );
}

/**
 * A segment's dedicated page. Only CATEGORY_FIRST is implemented today (the
 * existing Home Cleaning booking list); STORE_FIRST / SEARCH_FIRST can be
 * added as extra branches without touching the rest of Home.
 */
function SegmentView({
  segment,
  services,
  onBookService,
  onOpenTask,
}: {
  segment: Segment;
  services: SegmentService[];
  onBookService?: (s: BookServicePayload) => void;
  onOpenTask: (slug: string) => void;
}) {
  const t = useT();
  if (segment.display_template !== "CATEGORY_FIRST") {
    return (
      <div className="mt-8 rounded-[18px] border border-dashed border-border bg-card px-6 py-12 text-center">
        <p className="text-base font-bold text-foreground">
          {t("home.comingSoon", { segment: segment.name })}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t("home.comingSoonSub")}</p>
      </div>
    );
  }

  return (
    <>
      <h2 className="mt-5 text-lg font-extrabold tracking-tight text-foreground">
        {t("home.bookSegment", { segment: segment.name })}
      </h2>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {services.map((s) => (
          <ServiceMiniCard key={s.id} s={s} onBook={() => onBookService?.(toPayload(s, segment))} />
        ))}
      </div>


      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t("home.scheduleHint")}
      </p>

      <h2 className="mt-6 text-xl font-extrabold tracking-tight text-foreground">
        {t("home.oneExpert")}
      </h2>
      <ExpertTiles onOpenTask={onOpenTask} />
    </>
  );
}
