import { ensureSignedIn } from "@/lib/authGate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useStoreCart } from "@/lib/storeCart";
import { getCoordsIfPermitted } from "@/lib/nativeGeolocation";
import { ActiveOrdersStrip } from "@/components/home/ActiveOrdersStrip";
import { getAuthUser } from "@/lib/authUser";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { ChevronDown, ChevronRight, Clock, Gift, Home, MapPin, Mic, Search, Sparkles, User, Wind, type LucideIcon } from "lucide-react";
import { BadiyoLogo } from "./BadiyoLogo";
import { BottomNav } from "./BottomNav";
import { setCleanDraft } from "@/lib/cleanBookingDraft";
import { LocationPickerSheet, type SavedAddress } from "./LocationPickerSheet";
import { ContestHomeBanner } from "./contest/ContestHomeBanner";
import { supabase } from "@/integrations/supabase/client";
import { useResolveAddressCity } from "@/lib/customerCity";
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
import { fetchCourierEnabled } from "./courier/courierData";

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
import { StoreShelves } from "./store/storeCatalog";
import { CartBar } from "./store/CartBar";
import { CleanTab } from "./clean/CleanTab";
import type { SelectedSlot } from "@/lib/bookingTypes";
// Shop pages (with their address picker and payment sheet) load only when the
// customer actually opens a shop, a category or the cart.
// Store/Food tab bodies, search and deals load only when first shown.
const CommerceTab = lazy(() => import("./commerce/CommerceTab").then((m) => ({ default: m.CommerceTab })));
const LiveSearchPanel = lazy(() => import("./home/LiveSearchPanel").then((m) => ({ default: m.LiveSearchPanel })));
const BringBadiyosScreen = lazy(() => import("./BringBadiyosScreen").then((m) => ({ default: m.BringBadiyosScreen })));
const DealsHomeBanner = lazy(() => import("./deals/DealsTab").then((m) => ({ default: m.DealsHomeBanner })));
const CommerceStoreScreen = lazy(() =>
  import("./commerce/CommerceStoreScreen").then((m) => ({ default: m.CommerceStoreScreen })),
);
const StoreCartScreen = lazy(() =>
  import("./commerce/CommerceCheckoutScreen").then((m) => ({ default: m.CommerceCheckoutScreen })),
);

import type { TranslationKey } from "@/i18n/en";


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
import {
  fetchAvailability,
  type AvailabilityMap,
} from "@/lib/availability";



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
  onCheckout,
  onOpenReferral,
}: {
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
  onCheckout?: (service: BookServicePayload, slot: SelectedSlot, addressId: string | null) => Promise<"ok" | "need-address" | void> | void;
  onOpenReferral?: () => void;
}) {
  const { data: courierEnabled = false } = useQuery({
    queryKey: ["courier_enabled"],
    queryFn: () => fetchCourierEnabled(),
    staleTime: 5 * 60_000,
  });
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
  const [openStore, setOpenStoreRaw] = useState<{ id: string; distance_km?: number | null } | null>(null);
  const [lastStore, setLastStore] = useState<{ id: string; distance_km?: number | null } | null>(null);
  const [storeSource, setStoreSource] = useState<"browse" | "search" | "link" | "banner">("browse");
  const setOpenStore = (
    s: PublicStore | { id: string; distance_km?: number | null } | null,
    src: "browse" | "search" | "link" | "banner" = "browse",
  ) => {
    if (s) {
      setStoreSource(src);
      const ref = { id: s.id, distance_km: "distance_km" in s ? s.distance_km : null };
      setLastStore(ref);
      setOpenStoreRaw(ref);
    } else setOpenStoreRaw(null);
  };
  const [cartOpen, setCartOpen] = useState(false);
  const storeCart = useStoreCart();
  const cartHasItems = storeCart.cart.lines.length > 0;
  // One cart at a time across services: starting a Clean booking while the
  // shop cart has items asks to clear it first.
  const [pendingBook, setPendingBook] = useState<null | (() => void)>(null);
  const withSingleCart = (go: () => void) => {
    if (storeCart.cart.lines.length > 0) setPendingBook(() => go);
    else go();
  };
  // Ordering is on only when the store service itself is live.
  const storeOrdering = storeState?.status === "live";
  const { data: foodState } = useServiceState("food");
  const foodOrdering = foodState?.status === "live" || isTester;

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
      if (!uid) return getCoordsIfPermitted();
      const { data } = await supabase
        .from("addresses")
        .select("latitude, longitude")
        .eq("user_id", uid)
        .not("latitude", "is", null)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      const row = data?.[0];
      if (!row?.latitude || !row?.longitude) return getCoordsIfPermitted();
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

  const guardedBookService = (p: BookServicePayload) => {
    if (guardBlocked()) return;
    // Old service pages are gone: open the Clean booking page with this option.
    withSingleCart(() => {
      setCleanDraft({ auto: false, optionId: p.id ?? null, day: null, slotMins: null });
      setCleanKey((k) => k + 1);
      setTab("clean");
    });
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
  // Runs after the address picker closes (e.g. reopen the Clean booking sheet/page).
  const afterLocationRef = useRef<(() => void) | null>(null);
  const closeLocation = () => {
    setLocationSheetOpen(false);
    const cb = afterLocationRef.current;
    afterLocationRef.current = null;
    if (cb) setTimeout(cb, 250);
  };
  const [activeAddress, setActiveAddress] = useState<SavedAddress | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<HomeTab>("clean");
  const [cleanKey, setCleanKey] = useState(0);
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

  const addressTag = activeAddress?.label || t("nav.home");
  const locationLabel = activeAddress?.area || activeAddress?.full_address || activeAddress?.city || "";
  const [heroTone, setHeroTone] = useState<"light" | "dark">("light");
  const onLight = tab === "clean" && heroTone === "light";

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

  if (addressCity?.outside && activeAddress && cityDismissedFor !== activeAddress.id) {
    return (
      <Suspense fallback={null}>
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
      </Suspense>
    );
  }

  if (cartOpen) {
    return (
      <Suspense fallback={<ScreenSkeleton />}>
        <StoreCartScreen
          onBack={() => setCartOpen(false)}
          onAddMore={() => {
            setCartOpen(false);
            const id = storeCart.cart.merchantId;
            if (id && openStore?.id !== id) setOpenStore({ id, distance_km: lastStore?.id === id ? lastStore.distance_km : null });
          }}
          onAddAddress={() => {
            setCartOpen(false);
            setLocationSheetOpen(true);
          }}
          onDone={(orderId) => {
            setCartOpen(false);
            setOpenStore(null);
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
        <CommerceStoreScreen
          storeId={openStore.id}
          distanceKm={openStore.distance_km ?? null}
          onBack={() => setOpenStore(null)}
          onOpenCart={() => setCartOpen(true)}
          orderingEnabled={storeOrdering || foodOrdering}
          source={storeSource}
        />
      </Suspense>
    );
  }

  return (
    <main className="min-h-screen w-full bg-background pb-28 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="relative mx-auto w-full max-w-md px-5 pt-2">
        {/* Header: address on the left, wallet + profile on the right */}
        <header
          className={`bleed-safe-top z-30 flex items-center justify-between gap-3 px-5 pb-3 ${tab === "clean" ? "absolute inset-x-0 top-0 bg-transparent" : "sticky top-0 -mx-5 bg-background"}`}
          style={{ "--bleed-top-extra": "16px" } as React.CSSProperties}
        >
          <button
            onClick={() => setLocationSheetOpen(true)}
            className="min-w-0 flex-1 text-left"
            style={onLight ? { textShadow: "0 1px 4px color-mix(in oklab, var(--foreground) 45%, transparent)" } : undefined}
          >
            <span className={`flex items-center gap-1 text-[17px] font-extrabold leading-tight ${onLight ? "text-primary-foreground" : "text-foreground"}`}>
              <MapPin className={`h-4 w-4 shrink-0 ${onLight ? "text-primary-foreground" : "text-primary"}`} />
              <span className="truncate">{addressTag}</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </span>
            {locationLabel && (
              <span className={`mt-0.5 block truncate text-xs ${onLight ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{locationLabel}</span>
            )}
          </button>
          <button
            onClick={onOpenWallet}
            aria-label={t("home.walletAria")}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-extrabold text-primary ${tab === "clean" ? "bg-card shadow-soft" : "bg-primary/10"}`}
          >
            <WalletIcon className="h-4 w-4" />₹{coinBalance ?? 0}
          </button>
          <button
            onClick={onOpenProfile}
            aria-label={t("common.profile")}
            className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ${tab === "clean" ? "bg-card shadow-soft" : "bg-primary/10"}`}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={t("common.profile")} className="h-full w-full object-cover" decoding="async" />
            ) : (
              <User className="h-5 w-5 text-primary" />
            )}
          </button>
        </header>

        {/* Old search bar — Store/Food now have their own inside the tab */}
        {false && (
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
        )}
        {false && searchQuery.trim().length >= 2 && (
          <Suspense fallback={null}>
          <LiveSearchPanel
            query={searchQuery.trim()}
            coords={homeCoords}
            services={services}
            storeUnlocked={storeUnlocked}
            onOpenStore={(s) => {
              setSearchQuery("");
              setOpenStore(s, "search");
            }}
            onOpenService={(s) => {
              setSearchQuery("");
              guardedBookService(toPayload(s, segments.find((g) => g.id === s.segment_id) ?? null));
            }}
          />
          </Suspense>
        )}



        {tab !== "clean" && <ContestHomeBanner onOpen={onOpenContest} />}
        {tab !== "clean" && onOpenDeal && <div className="px-4"><Suspense fallback={null}><DealsHomeBanner onOpen={onOpenDeal} /></Suspense></div>}

        {tab === "clean" && cleanSegment ? (
          <CleanTab
            key={cleanKey}
            onHeroTone={setHeroTone}
            services={servicesFor(cleanSegment)}
            categories={categories.filter((c) => c.segment_id === cleanSegment.id)}
            promo={promo?.payload ?? null}
            addressLine={activeAddress ? `${addressTag}${locationLabel ? ` · ${locationLabel}` : ""}` : null}
            onChangeAddress={(onReturn) => {
              afterLocationRef.current = onReturn ?? null;
              setLocationSheetOpen(true);
            }}
            onOpenPromo={onOpenRewards}
            onOpenReferral={onOpenReferral ?? onOpenRewards}
            onCheckout={(o, slot) =>
              new Promise<void>((resolve) => {
                if (storeCart.cart.lines.length > 0) resolve(); // confirm dialog decides
                withSingleCart(async () => {
                  try {
                    const r = await onCheckout?.(toPayload(o, cleanSegment), slot, activeAddress?.id ?? null);
                    // No usable saved address: open the address sheet over the booking page.
                    if (r === "need-address") setLocationSheetOpen(true);
                  } finally {
                    resolve();
                  }
                });
              })
            }
          />
        ) : tab === "store" || tab === "food" ? (
          <Suspense fallback={<div className="mt-6 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-[18px] bg-muted" />)}</div>}>
            <CommerceTab
              key={tab}
              service={tab}
              coords={addressCity?.lat != null && addressCity?.lng != null ? { lat: addressCity.lat, lng: addressCity.lng } : homeCoords}
              onOpenStore={(s) => setOpenStore(s, "browse")}
              emptyFallback={tab === "food" ? (
          <section className="mt-6 flex flex-col items-center rounded-[20px] bg-surface-soft px-6 py-12 text-center">
            <div className="text-6xl">🍱</div>
            <h2 className="mt-4 text-2xl font-extrabold">{t("home.comingSoonTitle")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("home.foodSoonSub")}</p>
            <button
              onClick={async () => {
                if (!(await ensureSignedIn())) return;
                const { error } = await supabase.rpc("customer_notify_me" as never, {
                  _service_key: "food",
                  _city: activeAddress?.city?.split(",")[0]?.trim() || null,
                  _area: activeAddress?.area ?? null,
                  _lat: addressCity?.lat ?? homeCoords?.lat ?? null,
                  _lng: addressCity?.lng ?? homeCoords?.lng ?? null,
                } as never);
                if (error) toast.error(t("notServiceable.joinFailed"));
                else toast.success(t("notServiceable.onTheList"));
              }}
              className="mt-6 flex items-center gap-2 rounded-[20px] bg-primary px-6 py-3.5 text-base font-extrabold text-primary-foreground shadow-soft"
            >
              <BellRing className="h-5 w-5" />
              {t("bring.notify")}
            </button>
          </section>
              ) : undefined}
            />
          </Suspense>
        ) : null}


        {/* Promo banner — high-emphasis solid brand highlight */}
        {promo && tab !== "clean" && (
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

      {tab !== "clean" && <CartBar aboveNav onOpenCart={() => setCartOpen(true)} />}
      {!(tab !== "clean" && cartHasItems) && <ActiveOrdersStrip onOpenStoreOrder={onOpenStoreOrder} />}
      <AlertDialog open={!!pendingBook} onOpenChange={(o) => !o && setPendingBook(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new cart?</AlertDialogTitle>
            <AlertDialogDescription>
              Your cart has items from {storeCart.cart.storeName || "a shop"}. Clear and start new?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep cart</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const go = pendingBook;
                storeCart.clear();
                setPendingBook(null);
                go?.();
              }}
            >
              Clear and start new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <BottomNav
        activeKey={tab}
        onHome={setTab}
        onRewards={onOpenRewards ?? (() => {})}
        onParcel={courierEnabled ? onOpenCourier : () => toast(t("home.comingSoonTitle"))}
      />


      <LocationPickerSheet
        open={locationSheetOpen}
        activeId={activeAddress?.id ?? null}
        onClose={closeLocation}
        onSelect={(a) => {
          setActiveAddress(a);
          closeLocation();
        }}
      />
    </main>
  );
}

