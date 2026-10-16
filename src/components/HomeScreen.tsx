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
import { ActiveOrdersStrip } from "@/components/home/ActiveOrdersStrip";
import { getAuthUser } from "@/lib/authUser";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

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
import { CleanTab } from "./clean/CleanTab";
import type { SelectedSlot } from "@/lib/bookingTypes";
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

  return (
    <div className="mt-8 rounded-[18px] border border-dashed border-border bg-card px-6 py-12 text-center">
      <p className="text-base font-bold text-foreground">
        {t("home.comingSoon", { segment: segment.name })}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t("home.comingSoonSub")}</p>
    </div>
  );
}
