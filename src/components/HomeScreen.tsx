import { getAuthUser } from "@/lib/authUser";
import { lazy, Suspense, useEffect, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { ChevronDown, ChevronRight, Clock, Gift, Home, MapPin, Mic, Search, Sparkles, User, Wind, type LucideIcon } from "lucide-react";
import { BadiyoLogo } from "./BadiyoLogo";
import { BottomNav } from "./BottomNav";
import { LocationPickerSheet, type SavedAddress } from "./LocationPickerSheet";
import { ContestHomeBanner } from "./contest/ContestHomeBanner";
import { DealsHomeBanner } from "./deals/DealsTab";
import { supabase } from "@/integrations/supabase/client";
import { useResolveAddressCity } from "@/lib/customerCity";
import { BringBadiyosScreen } from "./BringBadiyosScreen";
import { readHomeTab, type HomeTab } from "@/lib/homeTab";
import { fetchMyCoinBalance } from "@/lib/coins";
import { BellRing, Wallet as WalletIcon } from "lucide-react";
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
import { fetchCourierEnabled } from "./courier/courierData";

import { SectionHeading } from "./SectionHeading";
import { BrandWatermark } from "./BrandWatermark";
import { anchorPrice } from "@/lib/price";
import { useLanguage, useT } from "@/i18n";
import { toast } from "sonner";
import { formatNextOpen, useServiceState } from "@/lib/serviceHours";
import { useIsInternalTester, type PublicStore } from "@/lib/store";
import {
  PENDING_STORE_EVENT,
  capturePendingStoreKey,
  clearPendingStoreKey,
  fetchStoreByKey,
} from "@/lib/storeShare";
import { StoreListView } from "./store/StoreListView";
import { StoreShelves } from "./store/storeCatalog";
import { LiveSearchPanel } from "./home/LiveSearchPanel";
import { CartBar } from "./store/CartBar";
// Shop pages (with their address picker and payment sheet) load only when the
// customer actually opens a shop, a category or the cart.
const StoreDetailScreen = lazy(() =>
  import("./store/StoreDetailScreen").then((m) => ({ default: m.StoreDetailScreen })),
);
const StoreCategoryScreen = lazy(() =>
  import("./store/StoreCategoryScreen").then((m) => ({ default: m.StoreCategoryScreen })),
);
const StoreCartScreen = lazy(() =>
  import("./store/StoreCartScreen").then((m) => ({ default: m.StoreCartScreen })),
);

import type { StoreCategoryGroup } from "./store/storeGroups";
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

/** Placeholder shown for the moment a shop page is being fetched. */
function ScreenSkeleton() {
  return (
    <div className="min-h-dvh space-y-3 bg-background p-4">
      <div className="h-10 w-2/3 animate-pulse rounded-xl bg-muted" />
      <div className="h-36 animate-pulse rounded-[18px] bg-muted" />
      <div className="h-24 animate-pulse rounded-[18px] bg-muted" />
      <div className="h-24 animate-pulse rounded-[18px] bg-muted" />
    </div>
  );
}



import { fetchSections } from "@/lib/homeData";
import { readLangOutsideReact, translateCatalog } from "@/lib/catalogI18n";
import {
  fetchAvailability,
  isUnavailable,
  unavailableReason,
  type AvailabilityMap,
} from "@/lib/availability";


const EXPERT_TILES: { image: string; labelKey: TranslationKey; slug: string; illustration?: boolean }[] = [
  { image: expertHouse, labelKey: "home.tile.houseCleaning", slug: "house-cleaning" },
  { image: expertDusting, labelKey: "home.tile.dusting", slug: "dusting-wiping" },
  { image: expertDishes, labelKey: "home.tile.dishes", slug: "cleaning-dishes" },
];

function ExpertTiles({ onOpenTask }: { onOpenTask: () => void }) {
  const t = useT();
  return (
    <div className="mt-5 grid grid-cols-3 gap-4">
      {EXPERT_TILES.map((tile) => (
        <button
          type="button"
          key={tile.labelKey}
          onClick={() => onOpenTask()}
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
  /** service_price_options.id — the authoritative item the customer picked. */
  id: string | null;
  service_category_id: string | null;
  duration_label: string;
  duration_minutes: number;
  price: number;
  subtitle: string | null;
  icon: string | null;
  segment_id: string | null;
  segment_name: string | null;
  service_name: string | null;
  strikethrough_price: number | null;
  pricing_type: string | null;
  image_url: string | null;
  gallery_urls: string[];
  video_url: string | null;
  description: string | null;
  inclusions: string[];
  exclusions: string[];
  task_types: SegmentService["task_types"];
};

function toPayload(s: SegmentService, segment?: Segment | null): BookServicePayload {
  return {
    id: s.id ?? null,
    service_category_id: s.service_category_id ?? null,
    duration_label: s.duration_label,
    duration_minutes: Number(s.duration_minutes),
    price: Number(s.price),
    subtitle: s.subtitle,
    icon: s.icon,
    segment_id: s.segment_id ?? segment?.id ?? null,
    segment_name: segment?.name ?? null,
    service_name: s.service_name ?? null,
    strikethrough_price: s.strikethrough_price ?? null,
    pricing_type: s.pricing_type ?? null,
    image_url: s.image_url ?? null,
    gallery_urls: s.gallery_urls ?? [],
    video_url: s.video_url ?? null,
    description: s.description ?? null,
    inclusions: s.inclusions ?? [],
    exclusions: s.exclusions ?? [],
    task_types: s.task_types ?? [],
  };
}


export function HomeScreen({
  onBookService,
  onQuickBook,
  onOpenProfile,
  onOpenRewards,
  onOpenContest,
  onOpenDeal,
  onOpenOrders,
  onOpenStoreOrder,
  onSearch,
  onOpenCourier,
  onOpenContactParcels,
  onOpenWallet,
  onRequireLogin,
}: {
  onBookService?: (service: BookServicePayload) => void;
  onQuickBook?: (service: BookServicePayload) => void;
  onOpenProfile?: () => void;
  onOpenRewards?: () => void;
  onOpenContest?: () => void;
  onOpenDeal?: (id: string) => void;
  onOpenOrders?: () => void;
  onOpenStoreOrder?: (orderId: string) => void;
  onSearch?: (query: string) => void;
  onOpenCourier?: () => void;
  onOpenContactParcels?: (stopId?: string) => void;
  onOpenWallet?: () => void;
  onRequireLogin?: () => void;
}) {
  const { data: courierEnabled = false } = useQuery({
    queryKey: ["courier_enabled"],
    queryFn: () => fetchCourierEnabled(),
    staleTime: 5 * 60_000,
  });
  const { data: segments = [] } = useQuery({ queryKey: ["segments"], queryFn: fetchSegments });
  // Courier has its own bottom-bar tab, so it never shows as a service chip.
  const visibleSegments = segments.filter((s) => s.slug !== "courier");
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
  const { data: availability } = useQuery({
    queryKey: ["availability_overrides"],
    queryFn: fetchAvailability,
    staleTime: 30_000,
  });
  const { data: avatarUrl } = useAvatarUrl();
  const t = useT();
  const { lang } = useLanguage();
  const { data: cleanState } = useServiceState("clean");

  // Store is behind a flag: live for everyone, or visible to internal testers.
  const { data: storeState } = useServiceState("store");
  const { data: isTester = false } = useIsInternalTester();
  const storeUnlocked = storeState?.status === "live" || isTester;
  const [openStore, setOpenStoreRaw] = useState<PublicStore | null>(null);
  const [storeSource, setStoreSource] = useState<"browse" | "search" | "link" | "banner">("browse");
  const setOpenStore = (
    s: PublicStore | null,
    src: "browse" | "search" | "link" | "banner" = "browse",
  ) => {
    if (s) setStoreSource(src);
    setOpenStoreRaw(s);
  };
  const [openCategory, setOpenCategory] = useState<StoreCategoryGroup | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  // Ordering is on only when the store service itself is live.
  const storeOrdering = storeState?.status === "live";

  /**
   * Shared store links (user.badiyos.com/store/<custom-name>) open that shop
   * directly — at launch, after sign-in, or when the app is already open.
   */
  useEffect(() => {
    let cancelled = false;
    async function openPending(key: string | null) {
      if (!key) return;
      const store = await fetchStoreByKey(key);
      clearPendingStoreKey();
      if (cancelled) return;
      if (!store) {
        toast.error("Ye dukaan abhi uplabdh nahi hai");
        return;
      }
      setOpenCategory(null);
      setOpenStore(store, "link");
    }
    void openPending(capturePendingStoreKey());
    const onPending = (e: Event) => {
      void openPending((e as CustomEvent<string>).detail);
    };
    window.addEventListener(PENDING_STORE_EVENT, onPending);
    return () => {
      cancelled = true;
      window.removeEventListener(PENDING_STORE_EVENT, onPending);
    };
  }, []);


  /** Customer coordinates used to sort shops nearest-first. */
  const { data: homeCoords = null } = useQuery({
    queryKey: ["home_default_coords"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ lat: number; lng: number } | null> => {
      const { data: userData } = await getAuthUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from("addresses")
        .select("latitude, longitude")
        .eq("user_id", uid)
        .not("latitude", "is", null)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      const row = data?.[0];
      if (!row?.latitude || !row?.longitude) return null;
      return { lat: Number(row.latitude), lng: Number(row.longitude) };
    },
  });

  /** Short ribbon copy shown in each tile corner when the service isn't orderable. */
  const statusBadge = ((): string | null => {
    if (!cleanState || cleanState.can_order) return null;
    if (cleanState.status === "coming_soon") return t("serviceState.comingSoon");
    const next = formatNextOpen(cleanState.next_open_at ?? cleanState.resume_at);
    return next ? t("serviceState.opensAt", { time: next }) : t("serviceState.closedNow");
  })();

  // Blocked only when the service itself isn't live (coming soon / stopped / hidden).
  // Merely being outside today's hours must NOT block browsing: the slot screen
  // still allows scheduling for a later day.
  const blockedMessage = (): string | null => {
    if (!cleanState || cleanState.status === "live") return null;
    const custom = lang === "mr" ? cleanState.message_mr ?? cleanState.message_en : cleanState.message_en ?? cleanState.message_mr;
    if (custom) return custom;
    if (cleanState.status === "coming_soon") return t("serviceState.comingSoon");
    const next = formatNextOpen(cleanState.next_open_at ?? cleanState.resume_at);
    return next ? t("serviceState.closedBanner", { time: next }) : t("serviceState.closedNow");
  };
  const guardBlocked = (): boolean => {
    const msg = blockedMessage();
    if (!msg) return false;
    toast(msg);
    return true;
  };

  const addToBooking = (s: SegmentService, segment?: Segment | null) => {
    if (guardBlocked()) return;
    toast(t("home.addedToBooking", { name: s.service_name || s.duration_label }));
    onQuickBook?.(toPayload(s, segment ?? null));
  };
  const guardedBookService = (p: BookServicePayload) => {
    if (guardBlocked()) return;
    onBookService?.(p);
  };


  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["segments"] }),
      queryClient.refetchQueries({ queryKey: ["segment_services"] }),
      queryClient.refetchQueries({ queryKey: ["service_categories"] }),
      queryClient.refetchQueries({ queryKey: ["homepage_sections"] }),
      queryClient.refetchQueries({ queryKey: ["availability_overrides"] }),
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
  const [tab, setTab] = useState<HomeTab>("clean");
  useEffect(() => setTab(readHomeTab()), []);
  const { data: coinBalance } = useQuery({
    queryKey: ["my_coin_balance"],
    queryFn: fetchMyCoinBalance,
    staleTime: 60_000,
  });

  // Cached so returning to Home does not re-run auth + address lookup on
  // every mount (that pair used to add a visible delay to the header).
  const { data: defaultAddress } = useQuery({
    queryKey: ["home_default_address"],
    queryFn: async (): Promise<SavedAddress | null> => {
      const { data: userData } = await getAuthUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from("addresses")
        .select("id, label, full_address, area, city, is_default")
        .eq("user_id", uid)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      return (data?.[0] as SavedAddress | undefined) ?? null;
    },
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (defaultAddress) setActiveAddress((prev) => prev ?? defaultAddress);
  }, [defaultAddress]);

  const addressCity = useResolveAddressCity(activeAddress?.id);
  const [cityDismissedFor, setCityDismissedFor] = useState<string | null>(null);

  const addressTag = activeAddress?.label || t("common.home");
  const locationLabel = activeAddress?.area || activeAddress?.full_address || activeAddress?.city || "";

  const activeSegment =
    tab === "food"
      ? null
      : segments.find((s) => s.slug === (tab === "store" ? "store" : "clean")) ?? null;
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
  const bookTileService = () => {
    if (tileService) guardedBookService(toPayload(tileService, cleanSegment));
  };

  if (addressCity?.outside && activeAddress && cityDismissedFor !== activeAddress.id) {
    return (
      <BringBadiyosScreen
        onRequireLogin={onRequireLogin}
        location={{
          latitude: addressCity.lat!,
          longitude: addressCity.lng!,
          addressText: activeAddress.full_address,
          city: activeAddress.city,
          area: activeAddress.area,
        }}
        onBack={() => setCityDismissedFor(activeAddress.id)}
        onChangeAddress={() => {
          setCityDismissedFor(activeAddress.id);
          setLocationSheetOpen(true);
        }}
      />
    );
  }

  if (cartOpen) {
    return (
      <Suspense fallback={<ScreenSkeleton />}>
        <StoreCartScreen
          onBack={() => setCartOpen(false)}
          onAddAddress={() => {
            setCartOpen(false);
            setLocationSheetOpen(true);
          }}
          onDone={(orderId) => {
            setCartOpen(false);
            setOpenStore(null);
            setOpenCategory(null);
            if (orderId && onOpenStoreOrder) onOpenStoreOrder(orderId);
            else onOpenOrders?.();
          }}
        />
      </Suspense>
    );
  }
  if (openStore) {
    return (
      <Suspense fallback={<ScreenSkeleton />}>
        <StoreDetailScreen
          store={openStore}
          onBack={() => setOpenStore(null)}
          onOpenCart={() => setCartOpen(true)}
          orderingEnabled={storeOrdering}
          source={storeSource}
        />
      </Suspense>
    );
  }
  if (openCategory) {
    return (
      <Suspense fallback={<ScreenSkeleton />}>
        <StoreCategoryScreen
          coords={homeCoords ?? null}
          group={openCategory}
          onBack={() => setOpenCategory(null)}
          onOpenStore={setOpenStore}
          onOpenCart={() => setCartOpen(true)}
          orderingEnabled={storeOrdering}
        />
      </Suspense>
    );
  }


  return (
    <main className="min-h-screen w-full bg-background pb-28 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-2">
        {/* Header: address on the left, wallet + profile on the right */}
        <header
          className="bleed-safe-top sticky top-0 z-30 -mx-5 flex items-center justify-between gap-3 bg-background px-5 pb-3"
          style={{ "--bleed-top-extra": "16px" } as React.CSSProperties}
        >
          <button
            onClick={() => setLocationSheetOpen(true)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex items-center gap-1 text-[17px] font-extrabold leading-tight text-foreground">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{addressTag}</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </span>
            {locationLabel && (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{locationLabel}</span>
            )}
          </button>
          <button
            onClick={onOpenWallet}
            aria-label={t("home.walletAria")}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-sm font-extrabold text-primary"
          >
            <WalletIcon className="h-4 w-4" />₹{coinBalance ?? 0}
          </button>
          <button
            onClick={onOpenProfile}
            aria-label={t("common.profile")}
            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={t("common.profile")} className="h-full w-full object-cover" decoding="async" />
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
          className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-2.5 shadow-sm"
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
        {searchQuery.trim().length >= 2 && (
          <LiveSearchPanel
            query={searchQuery.trim()}
            coords={homeCoords}
            services={services}
            storeUnlocked={storeUnlocked}
            onOpenStore={(s) => {
              setSearchQuery("");
              setOpenCategory(null);
              setOpenStore(s, "search");
            }}
            onOpenService={(s) => {
              setSearchQuery("");
              guardedBookService(toPayload(s, segments.find((g) => g.id === s.segment_id) ?? null));
            }}
          />
        )}



        <ContestHomeBanner onOpen={onOpenContest} />
        {onOpenDeal && <div className="px-4"><DealsHomeBanner onOpen={onOpenDeal} /></div>}

        {activeSegment ? (
        <SegmentView
          segment={activeSegment}
          categories={categories.filter((c) => c.segment_id === activeSegment.id)}
          services={servicesFor(activeSegment)}
          onBookService={guardedBookService}
          onAdd={(s) => addToBooking(s, activeSegment)}
          onOpenTask={bookTileService}
          availability={availability}
          statusBadge={statusBadge}
          storeUnlocked={storeUnlocked}
          storeCoords={homeCoords}
          onOpenStore={setOpenStore}
          onOpenCategory={setOpenCategory}
          onOpenCart={() => setCartOpen(true)}
          storeOrdering={storeOrdering}
        />
        ) : (
          <section className="mt-6 flex flex-col items-center rounded-[20px] bg-surface-soft px-6 py-12 text-center">
            <div className="text-6xl">🍱</div>
            <h2 className="mt-4 text-2xl font-extrabold">{t("home.comingSoonTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("home.foodSoonSub")}</p>
            <button
              onClick={() => toast.success(t("notServiceable.onTheList"))}
              className="mt-6 flex items-center gap-2 rounded-[20px] bg-primary px-6 py-3.5 text-base font-extrabold text-primary-foreground shadow-soft"
            >
              <BellRing className="h-5 w-5" />
              {t("bring.notify")}
            </button>
          </section>
        )}

        {storeUnlocked && false && (
          <StoreShelves coords={homeCoords} onOpenStore={(s) => setOpenStore(s)} />
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

        <BrandWatermark />
      </div>

      {storeUnlocked && <CartBar aboveNav onOpenCart={() => setCartOpen(true)} />}
      <BottomNav
        activeKey={tab}
        onHome={setTab}
        onRewards={onOpenRewards ?? (() => {})}
        onParcel={courierEnabled ? onOpenCourier : () => toast(t("home.comingSoonTitle"))}
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
 * A segment's dedicated page. CATEGORY_FIRST is the existing Home Cleaning
 * booking list; STORE_FIRST is the read-only shop browser, gated behind the
 * store service flag (or the internal-tester list).
 */
function SegmentView({
  segment,
  categories,
  services,
  onBookService,
  onAdd,
  onOpenTask,
  availability,
  statusBadge,
  storeUnlocked,
  storeCoords,
  onOpenStore,
  onOpenCategory,
  onOpenCart,
  storeOrdering,
}: {
  segment: Segment;
  categories: ServiceCategory[];
  services: SegmentService[];
  onBookService?: (s: BookServicePayload) => void;
  onAdd: (s: SegmentService) => void;
  onOpenTask: () => void;
  availability?: AvailabilityMap;
  statusBadge?: string | null;
  storeUnlocked?: boolean;
  storeCoords?: { lat: number; lng: number } | null;
  onOpenStore?: (store: PublicStore) => void;
  onOpenCategory?: (group: StoreCategoryGroup) => void;
  onOpenCart?: () => void;
  storeOrdering?: boolean;
}) {
  const t = useT();

  if (segment.display_template === "STORE_FIRST" && storeUnlocked) {
    return (
      <StoreListView
        coords={storeCoords ?? null}
        onOpenStore={(s) => onOpenStore?.(s)}
        onOpenCategory={(g) => onOpenCategory?.(g)}
        onOpenCart={() => onOpenCart?.()}
        orderingEnabled={storeOrdering}
      />
    );
  }

  if (segment.display_template !== "CATEGORY_FIRST") {
    return (
      <>
        <div className="mt-8 rounded-[18px] border border-dashed border-border bg-card px-6 py-12 text-center">
          <p className="text-base font-bold text-foreground">
            {t("home.comingSoon", { segment: segment.name })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.comingSoonSub")}</p>
        </div>
      </>
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
            onViewDetail={(s) => onBookService?.(toPayload(s, segment))}
            onAdd={(s) => onAdd(s)}
            availability={availability}
            statusBadge={statusBadge}
          />
        );
      })}


      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t("home.scheduleHint")}
      </p>

      {segment.slug?.toLowerCase().includes("clean") && (
        <>
          <SectionHeading size="lg" className="mt-7">
            {t("home.oneExpert")}
          </SectionHeading>
          <ExpertTiles onOpenTask={onOpenTask} />
        </>
      )}

    </>
  );
}

/** One category's labelled row of compact product cards. */
function CategoryRow({
  category,
  services,
  onViewDetail,
  onAdd,
  availability,
  statusBadge,
}: {
  category: ServiceCategory;
  services: SegmentService[];
  onViewDetail: (s: SegmentService) => void;
  onAdd: (s: SegmentService) => void;
  availability?: AvailabilityMap;
  statusBadge?: string | null;
}) {
  const t = useT();
  const categoryBlocked = isUnavailable(availability, "category", category.id);
  const categoryReason = unavailableReason(availability, "category", category.id);
  return (
    <div className={`mt-4 ${categoryBlocked ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-bold tracking-[-0.01em] text-muted-foreground">
          {translateCatalog(category.name, readLangOutsideReact())}
        </h3>
        {categoryBlocked ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            {categoryReason || t("home.unavailableBadge")}
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2.5">
        {services.map((s) => (
          <ServiceProductCard
            key={s.id}
            service={{
              name: s.duration_label,
              price: Number(s.price),
              strikePrice: s.strikethrough_price,
              imageUrl: s.image_url,
              durationMinutes: s.pricing_type === "flat" ? null : s.duration_minutes,
            }}
            unavailable={categoryBlocked || isUnavailable(availability, "item", s.id)}
            unavailableLabel={
              categoryReason || unavailableReason(availability, "item", s.id) || null
            }
            statusBadge={statusBadge}
            onViewDetail={() => onViewDetail(s)}
            onAdd={() => onAdd(s)}
          />
        ))}
      </div>

    </div>
  );
}
