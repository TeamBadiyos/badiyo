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
import {
  fetchSegmentServices,
  fetchSegments,
  fetchServiceCategories,
  type Segment,
  type SegmentService,
  type ServiceCategory,
} from "@/lib/segments";
import { ServiceProductCard } from "./home/ServiceProductCard";
import { SectionHeading } from "./SectionHeading";
import { anchorPrice } from "@/lib/price";
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


const EXPERT_TILES: { image: string; labelKey: TranslationKey; slug: string; illustration?: boolean }[] = [
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
          <div
            className={`${tile.illustration ? "brand-grade-soft" : "brand-grade"} aspect-square overflow-hidden rounded-[18px] bg-muted shadow-card-m`}
          >
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
  const { data: categories = [] } = useQuery({
    queryKey: ["service_categories"],
    queryFn: fetchServiceCategories,
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
      queryClient.refetchQueries({ queryKey: ["service_categories"] }),
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
  const servicesForCategory = (category: ServiceCategory) =>
    services.filter((s) => s.service_category_id === category.id);

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
          className="bleed-safe-top sticky top-0 z-30 -mx-5 flex items-center justify-between gap-3 bg-background px-5 pb-3"
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
          className="flex items-center gap-3 rounded-[16px] border border-border bg-card px-4 py-3 shadow-sm"
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
            categories={categories.filter((c) => c.segment_id === activeSegment.id)}
            services={servicesFor(activeSegment)}
            onBookService={onBookService}
            onOpenTask={openIncluded}
          />
        ) : (
          <div className="mt-2">
            {segments.map((segment) => {
              const segmentCategories = categories.filter(
                (c) => c.segment_id === segment.id && servicesForCategory(c).length > 0,
              );
              if (segmentCategories.length === 0) return null;
              return (
                <section key={segment.id} className="mt-6 first:mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <SectionHeading>{segment.name}</SectionHeading>
                    <button
                      onClick={() => setActiveSegmentId(segment.id)}
                      className="flex items-center gap-0.5 text-sm font-bold text-primary"
                    >
                      {t("home.seeAll")}
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  {segmentCategories.map((category) => (
                    <CategoryRow
                      key={category.id}
                      category={category}
                      services={servicesForCategory(category).slice(0, 3)}
                      onBook={(s) => onBookService?.(toPayload(s, segment))}
                    />
                  ))}
                </section>
              );
            })}

            {/* Expert tiles */}
            <SectionHeading size="lg" className="mt-7">
              {t("home.oneExpert")}
            </SectionHeading>
            <ExpertTiles onOpenTask={openIncluded} />
          </div>
        )}

        {/* Promo banner — high-emphasis solid brand highlight */}
        {promo && (
          <button
            onClick={onOpenRewards}
            className="promo-texture-on-brand surface-brand mt-6 flex w-full items-center gap-3 overflow-hidden rounded-[18px] p-4 text-left shadow-card-m transition active:scale-[0.98]"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
              <Icon name={promo.payload?.icon} className="h-5 w-5 text-primary-foreground" />
            </div>
            <p className="flex-1 text-sm font-bold text-primary-foreground leading-snug">
              {promo.payload?.text}
            </p>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground text-primary"
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
  categories,
  services,
  onBookService,
  onOpenTask,
}: {
  segment: Segment;
  categories: ServiceCategory[];
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
      <SectionHeading className="mt-4">
        {t("home.bookSegment", { segment: segment.name })}
      </SectionHeading>

      {categories.map((category) => {
        const items = services.filter((s) => s.service_category_id === category.id);
        if (items.length === 0) return null;
        return (
          <CategoryRow
            key={category.id}
            category={category}
            services={items}
            onBook={(s) => onBookService?.(toPayload(s, segment))}
          />
        );
      })}


      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t("home.scheduleHint")}
      </p>

      <SectionHeading size="lg" className="mt-7">
        {t("home.oneExpert")}
      </SectionHeading>
      <ExpertTiles onOpenTask={onOpenTask} />
    </>
  );
}

/** One category's labelled row of compact product cards. */
function CategoryRow({
  category,
  services,
  onBook,
}: {
  category: ServiceCategory;
  services: SegmentService[];
  onBook: (s: SegmentService) => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="text-[13px] font-bold tracking-[-0.01em] text-muted-foreground">
        {category.name}
      </h3>
      <div className="mt-2 grid grid-cols-3 gap-2.5">
        {services.map((s) => (
          <ServiceProductCard
            key={s.id}
            service={{
              name: s.duration_label,
              price: Number(s.price),
              imageUrl: s.image_url,
              durationMinutes: s.duration_minutes,
            }}
            onAdd={() => onBook(s)}
          />
        ))}
      </div>
    </div>
  );
}
