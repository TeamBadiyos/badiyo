import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  initNativeBackButton,
  setRootBackHandler,
  hasOverlayHandler,
  runTopOverlayHandler,
} from "@/lib/backHandler";
import { useEdgeSwipeBack } from "@/lib/useEdgeSwipeBack";
import { initStatusBar } from "@/lib/statusBar";

import { BadiyoLogo } from "@/components/BadiyoLogo";
import type { NotServiceableLocation } from "@/components/NotServiceableScreen";
import { checkServiceability } from "@/lib/serviceability";
import { hasLoginPin } from "@/lib/auth.functions";
import { prefetchHomeData } from "@/lib/homeData";

// --- Eager: only what the very first paint needs (splash → login). ---
import { LoginScreen } from "@/components/LoginScreen";

// --- Lazy: every other screen loads on demand. ---
function lazyNamed<M, K extends keyof M>(loader: () => Promise<M>, key: K) {
  type P = M[K] extends ComponentType<infer Props> ? Props : never;
  return lazy<ComponentType<P>>(() =>
    loader().then((m) => ({ default: m[key] as unknown as ComponentType<P> })),
  );
}


const HomeScreen = lazyNamed(() => import("@/components/HomeScreen"), "HomeScreen");
const OtpVerifyScreen = lazyNamed(() => import("@/components/OtpVerifyScreen"), "OtpVerifyScreen");
const PinLoginScreen = lazyNamed(() => import("@/components/PinLoginScreen"), "PinLoginScreen");
const PinSetScreen = lazyNamed(() => import("@/components/PinSetScreen"), "PinSetScreen");
const NotServiceableScreen = lazyNamed(
  () => import("@/components/NotServiceableScreen"),
  "NotServiceableScreen",
);
const SlotSelectionScreen = lazyNamed(
  () => import("@/components/SlotSelectionScreen"),
  "SlotSelectionScreen",
);
const AddressSelectionScreen = lazyNamed(
  () => import("@/components/AddressSelectionScreen"),
  "AddressSelectionScreen",
);
const BookingSummaryScreen = lazyNamed(
  () => import("@/components/BookingSummaryScreen"),
  "BookingSummaryScreen",
);
const PaymentScreen = lazyNamed(() => import("@/components/PaymentScreen"), "PaymentScreen");
const ExpertAssignedScreen = lazyNamed(
  () => import("@/components/tracking/ExpertAssignedScreen"),
  "ExpertAssignedScreen",
);
const SearchingForExpertScreen = lazyNamed(
  () => import("@/components/tracking/SearchingForExpertScreen"),
  "SearchingForExpertScreen",
);
const OtpScreen = lazyNamed(() => import("@/components/tracking/OtpScreen"), "OtpScreen");
const ServiceInProgressScreen = lazyNamed(
  () => import("@/components/tracking/ServiceInProgressScreen"),
  "ServiceInProgressScreen",
);
const RateReviewScreen = lazyNamed(
  () => import("@/components/tracking/RateReviewScreen"),
  "RateReviewScreen",
);
const MyBookingsScreen = lazyNamed(
  () => import("@/components/MyBookingsScreen"),
  "MyBookingsScreen",
);
const BookingDetailsScreen = lazyNamed(
  () => import("@/components/BookingDetailsScreen"),
  "BookingDetailsScreen",
);
const ProfileScreen = lazyNamed(() => import("@/components/ProfileScreen"), "ProfileScreen");
const WalletScreen = lazyNamed(() => import("@/components/WalletScreen"), "WalletScreen");
const RewardsScreen = lazyNamed(() => import("@/components/RewardsScreen"), "RewardsScreen");
const EditProfileScreen = lazyNamed(
  () => import("@/components/profile/EditProfileScreen"),
  "EditProfileScreen",
);
const NotificationsScreen = lazyNamed(
  () => import("@/components/profile/NotificationsScreen"),
  "NotificationsScreen",
);
const SettingsScreen = lazyNamed(
  () => import("@/components/profile/SettingsScreen"),
  "SettingsScreen",
);
const HelpSupportScreen = lazyNamed(
  () => import("@/components/profile/HelpSupportScreen"),
  "HelpSupportScreen",
);
const AboutScreen = lazyNamed(() => import("@/components/profile/AboutScreen"), "AboutScreen");
const LegalPageScreen = lazyNamed(
  () => import("@/components/profile/LegalPageScreen"),
  "LegalPageScreen",
);
const ActiveDevicesScreen = lazyNamed(
  () => import("@/components/profile/ActiveDevicesScreen"),
  "ActiveDevicesScreen",
);
const LanguageScreen = lazyNamed(
  () => import("@/components/profile/LanguageScreen"),
  "LanguageScreen",
);
const DeviceLimitScreen = lazyNamed(
  () => import("@/components/DeviceLimitScreen"),
  "DeviceLimitScreen",
);
const ReferralDashboardScreen = lazyNamed(
  () => import("@/components/ReferralDashboardScreen"),
  "ReferralDashboardScreen",
);
const PaymentMethodsScreen = lazyNamed(
  () => import("@/components/profile/PaymentMethodsScreen"),
  "PaymentMethodsScreen",
);
const SearchResultsScreen = lazyNamed(
  () => import("@/components/SearchResultsScreen"),
  "SearchResultsScreen",
);
const OrdersScreen = lazyNamed(() => import("@/components/OrdersScreen"), "OrdersScreen");
const NoInternetScreen = lazyNamed(
  () => import("@/components/utility/NoInternetScreen"),
  "NoInternetScreen",
);
const ForceUpdateScreen = lazyNamed(
  () => import("@/components/utility/ForceUpdateScreen"),
  "ForceUpdateScreen",
);

import type { SelectedService, SelectedSlot } from "@/components/SlotSelectionScreen";
import type { SelectedAddress } from "@/components/BookingSummaryScreen";
import type { BookingRow } from "@/components/MyBookingsScreen";
import type { LegalSlug } from "@/components/profile/LegalPageScreen";
import { ACTIVE_TRACKING_STATUSES } from "@/lib/bookingStatus";
import { registerThisDevice, type DeviceSession } from "@/lib/devices";
import { ensureUserRow } from "@/lib/ensureUserRow";
import { registerPushForCurrentUser, setPushNavigator } from "@/lib/push";
import { APP_VERSION, fetchMinSupportedVersion, isBelow } from "@/lib/version";
import { supabase } from "@/integrations/supabase/client";

/** Full-screen brand placeholder shown while a lazy screen chunk loads. */
function ScreenFallback() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" />
    </div>
  );
}



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "badiyos — Home cleaning, on demand" },
      { name: "description", content: "Book trusted home cleaning services in Latur with badiyos. Fast, reliable experts — just a tap away." },
      { property: "og:title", content: "badiyos — Home cleaning, on demand" },
      { property: "og:description", content: "Book trusted home cleaning services in Latur with badiyos. Fast, reliable experts — just a tap away." },
    ],
  }),
  component: Index,
});

type Phase =
  | "splash"
  | "splash-out"
  | "login"
  | "otp-verify"
  | "pin-login"
  | "pin-set"
  | "home"
  | "slot"
  | "address"
  | "manage-addresses"
  | "summary"
  | "payment"
  | "searching-expert"
  | "expert-assigned"
  | "otp-start"
  | "in-progress"
  | "otp-end"
  | "rate-review"
  | "my-bookings"
  | "booking-details"
  | "profile"
  | "wallet"
  | "rewards"
  | "edit-profile"
  | "notifications"
  | "settings"
  | "help"
  | "about"
  | "referrals"
  | "payment-methods"
  | "search-results"
  | "orders"
  | "active-devices"
  | "language"
  | "device-limit"
  | "legal"
  | "not-serviceable";



function Index() {
  const [phase, _setPhase] = useState<Phase>("splash");
  const historyRef = useRef<Phase[]>([]);
  const phaseRef = useRef<Phase>("splash");
  const lastBackAtRef = useRef<number>(0);

  const setPhase = useCallback((next: Phase) => {
    _setPhase((prev) => {
      if (next === prev) return prev;
      // Home is the root — clear history when returning to it.
      if (next === "home") {
        historyRef.current = [];
      } else if (prev !== "splash" && prev !== "splash-out") {
        historyRef.current.push(prev);
      }
      phaseRef.current = next;
      return next;
    });
  }, []);

  const [legal, setLegal] = useState<{ slug: LegalSlug; from: Phase } | null>(null);
  const [selectedService, setSelectedService] = useState<SelectedService | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<SelectedAddress | null>(null);
  const [notServiceable, setNotServiceable] = useState<NotServiceableLocation | null>(null);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [activeBookingStatus, setActiveBookingStatus] = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [forceResetPin, setForceResetPin] = useState(false);
  // Always start "online" so SSR and first client render match; a real offline
  // state is picked up in the effect below after hydration.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
  }, []);

  const [forceUpdate, setForceUpdate] = useState(false);
  const [limitDevices, setLimitDevices] = useState<DeviceSession[]>([]);
  const queryClient = useQueryClient();

  // Enter the app immediately after a successful login. The max-2-device
  // check used to block navigation (one extra sequential round-trip between
  // PIN verification and Home); it now runs in the background and only
  // interrupts if the limit is actually reached.
  const enterAppAfterAuth = useCallback(
    (fallbackPhase: Phase = "home") => {
      setPhase(fallbackPhase);
      // Home data + Home chunk start loading in parallel with the device call.
      void prefetchHomeData(queryClient);
      void import("@/components/HomeScreen");
      void registerThisDevice()
        .then((res) => {
          if (res.status === "limit_reached") {
            setLimitDevices(res.devices);
            setPhase("device-limit");
          }
        })
        .catch((e) => console.error("device registration failed:", e));
    },
    [setPhase, queryClient],
  );


  function resetAndGoHome() {
    setActiveBookingId(null);
    setSelectedService(null);
    setSelectedSlot(null);
    setSelectedAddress(null);
    setPhase("home");
  }

  // Shared back logic for the hardware back button and the edge-swipe gesture.
  const isAtRootPhase = useCallback((p: Phase) => {
    return (
      p === "home" ||
      p === "login" ||
      p === "otp-verify" ||
      p === "pin-login" ||
      p === "pin-set" ||
      p === "splash" ||
      p === "splash-out"
    );
  }, []);

  const goBack = useCallback(
    (allowExit: boolean) => {
      const cur = phaseRef.current;
      const hist = historyRef.current;
      if (!isAtRootPhase(cur) && hist.length > 0) {
        const prev = hist.pop()!;
        phaseRef.current = prev;
        _setPhase(prev);
        return;
      }
      if (!allowExit) return;
      // At root — require a second back press within 2s to exit.
      const now = Date.now();
      if (now - lastBackAtRef.current < 2000) {
        import("@capacitor/app").then(({ App }) => App.exitApp()).catch(() => {});
        return;
      }
      lastBackAtRef.current = now;
      toast("Press back again to exit", { duration: 2000 });
    },
    [isAtRootPhase],
  );

  // Status bar: keep native content below the status bar (no-op on web).
  useEffect(() => {
    void initStatusBar();
  }, []);

  // Wire the native Android back button (no-op on web).
  useEffect(() => {
    initNativeBackButton();
    setRootBackHandler(() => goBack(true));
    return () => setRootBackHandler(null);
  }, [goBack]);

  // iOS-style edge swipe from the left to go back (never exits the app).
  const canSwipeBack = !isAtRootPhase(phase) && historyRef.current.length > 0;
  const swipeBack = useEdgeSwipeBack(
    canSwipeBack
      ? () => {
          if (hasOverlayHandler()) {
            runTopOverlayHandler();
            return;
          }
          goBack(false);
        }
      : null,
    canSwipeBack,
  );



  // Route pushes tapped from a notification (data.route) into an app phase.
  useEffect(() => {
    const ROUTE_TO_PHASE: Record<string, Phase> = {
      "/": "home",
      home: "home",
      orders: "orders",
      "my-bookings": "my-bookings",
      rewards: "rewards",
      referrals: "referrals",
      wallet: "wallet",
      profile: "profile",
    };
    setPushNavigator((route, data) => {
      const phase = ROUTE_TO_PHASE[route];
      if (phase) {
        setPhase(phase);
        return;
      }
      // Booking deep link: "/booking/<id>" or data.bookingId
      const bookingId =
        (typeof data?.bookingId === "string" && (data.bookingId as string)) ||
        (route.startsWith("booking/") ? route.slice("booking/".length) : null) ||
        (route.startsWith("/booking/") ? route.slice("/booking/".length) : null);
      if (bookingId) {
        setActiveBookingId(bookingId);
        setPhase("expert-assigned");
      }
    });
    return () => setPushNavigator(null);
  }, [setPhase]);



  useEffect(() => {
    let cancelled = false;

    // Home content is public config data — warm it during the splash so Home
    // paints from cache the moment the user finishes logging in.
    void prefetchHomeData(queryClient);

    fetchMinSupportedVersion().then((min) => {
      if (!cancelled && min && isBelow(APP_VERSION, min)) setForceUpdate(true);
    });

    // If we're returning from Google OAuth, a session will already exist —
    // skip the splash and go straight to home once it's confirmed.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.user && !data.session.user.is_anonymous) {
        enterAppAfterAuth("home");
        ensureUserRow()
          .then(() => import("@/lib/referrals").then((m) => m.linkReferralIfAny()))
          .then(() => registerPushForCurrentUser())
          .catch((e) => console.error("post-oauth setup failed:", e));
        return;
      }
      // Otherwise run the normal splash → login flow. Warm the screens the
      // user is about to hit so no chunk download sits on the critical path.
      void import("@/components/PinLoginScreen");
      void import("@/components/OtpVerifyScreen");
      void import("@/components/HomeScreen");
      setTimeout(() => !cancelled && setPhase("splash-out"), 1800);
      setTimeout(() => !cancelled && setPhase("login"), 2300);
      ensureUserRow().catch((e) => console.error("startup ensureUserRow failed:", e));
    });


    const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        try {
          await ensureUserRow();
          const { linkReferralIfAny } = await import("@/lib/referrals");
          await linkReferralIfAny();
          registerPushForCurrentUser().catch(() => {});
        } catch (e) {
          console.error("ensureUserRow failed:", e);
        }
      }
    });
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <div
      className="relative min-h-screen w-full app-safe-shell momentum-scroll"
      style={swipeBack.style}
    >
      {swipeBack.dragging && (
        <div
          className="pointer-events-none fixed inset-0 z-40 bg-foreground"
          style={{ opacity: Math.max(0, 0.18 * (1 - swipeBack.progress)) }}
        />
      )}
      <Suspense fallback={null}>
        {forceUpdate && <ForceUpdateScreen />}
        {!online && <NoInternetScreen onRetry={() => setOnline(navigator.onLine)} />}
      </Suspense>

      <Suspense fallback={<ScreenFallback />}>


      {(phase === "splash" || phase === "splash-out") && (
        <div
          className={`fixed inset-0 flex items-center justify-center badiyo-green ${
            phase === "splash-out" ? "animate-fade-out" : ""
          }`}
        >
          <div className="flex flex-col items-center">
            <BadiyoLogo className="w-64 max-w-[70vw] animate-logo-in" />
            <p className="mt-4 text-center text-sm font-light text-white/90">
              हर घर का अपना साथी
            </p>
          </div>
        </div>
      )}
      {phase === "login" && (
        <div className="animate-fade-slide-in">
          <LoginScreen
            onOtpSent={(p) => {
              setPendingPhone(p);
              setPhase("otp-verify");
            }}
            onPinLogin={(p) => {
              setPendingPhone(p);
              setPhase("pin-login");
            }}
            onOpenLegal={(slug) => {
              setLegal({ slug, from: "login" });
              setPhase("legal");
            }}
          />
        </div>
      )}
      {phase === "pin-login" && pendingPhone && (
        <div className="animate-fade-slide-in">
          <PinLoginScreen
            phone={pendingPhone}
            onBack={() => setPhase("login")}
            onVerified={() => {
              enterAppAfterAuth("home");
              ensureUserRow(`+91${pendingPhone}`)
                .then(() => import("@/lib/referrals").then((m) => m.linkReferralIfAny()))
                .catch((e) => console.error("post-pin-login setup failed:", e));
            }}
            onFallbackOtp={async () => {
              setPhase("otp-verify");
              try {
                await supabase.functions.invoke("send-otp", { body: { phone: pendingPhone } });
              } catch (e) {
                console.error("otp fallback send-otp failed", e);
                toast.error("Couldn't send OTP. Please tap Resend OTP.");
              }
            }}
            onForgotPin={async () => {
              setForceResetPin(true);
              setPhase("otp-verify");
              try {
                await supabase.functions.invoke("send-otp", { body: { phone: pendingPhone } });
              } catch (e) {
                console.error("forgot-pin send-otp failed", e);
                toast.error("Couldn't send OTP. Please tap Resend OTP.");
              }
            }}
          />
        </div>
      )}
      {phase === "pin-set" && pendingPhone && (
        <div className="animate-fade-slide-in">
          <PinSetScreen
            phone={pendingPhone}
            onDone={() => setPhase("home")}
          />
        </div>
      )}
      {phase === "otp-verify" && pendingPhone && (
        <div className="animate-fade-slide-in">
          <OtpVerifyScreen
            phone={pendingPhone}
            onOpenLegal={(slug) => {
              setLegal({ slug, from: "otp-verify" });
              setPhase("legal");
            }}
            onBack={() => setPhase("login")}
            onVerified={async () => {
              // Ensure profile row exists, then check whether the customer
              // already has a PIN. If not, force the PIN-set screen.
              // Every step is time-boxed: a hung network call must never leave
              // the user stranded on the OTP screen after a valid code.
              const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
                Promise.race([
                  p,
                  new Promise<never>((_, rej) =>
                    setTimeout(() => rej(new Error(`${label} timed out`)), ms),
                  ),
                ]);
              console.info("[otp] verified — starting post-OTP setup");
              try {
                await withTimeout(ensureUserRow(`+91${pendingPhone}`), 8000, "ensureUserRow");
                console.info("[otp] ensureUserRow ok");
                import("@/lib/referrals").then((m) => m.linkReferralIfAny()).catch(() => {});
                let hasPin = false;
                try {
                  const res = await withTimeout(
                    hasLoginPin({ data: { phone: pendingPhone } }),
                    8000,
                    "hasLoginPin",
                  );
                  hasPin = res.hasPin;
                } catch (pinErr) {
                  console.warn("[otp] hasLoginPin check failed", pinErr);
                }
                console.info("[otp] hasPin:", hasPin, "forceReset:", forceResetPin);
                if (forceResetPin || !hasPin) {
                  setForceResetPin(false);
                  setPhase("pin-set");
                  void enterAppAfterAuth("pin-set");
                } else {
                  setPhase("home");
                  void enterAppAfterAuth("home");
                }
                console.info("[otp] navigation dispatched");
              } catch (e) {
                console.error("[otp] post-otp setup failed:", e);
                setPhase("home");
                void enterAppAfterAuth("home");
              }
            }}

          />

        </div>
      )}
      {phase === "home" && (
        <div className="animate-fade-slide-in">
          <HomeScreen
            onBookService={(s) => {
              setSelectedService(s);
              setPhase("slot");
            }}
            onOpenProfile={() => setPhase("profile")}
            onOpenRewards={() => setPhase("rewards")}
            onOpenOrders={() => setPhase("orders")}
            onSearch={(q) => {
              setSearchQuery(q);
              setPhase("search-results");
            }}
          />

        </div>
      )}
      {phase === "slot" && selectedService && (
        <div className="animate-fade-slide-in">
          <SlotSelectionScreen
            service={selectedService}
            onBack={() => setPhase("home")}
            onContinue={(slot) => {
              setSelectedSlot(slot);
              setPhase("address");
            }}
          />
        </div>
      )}
      {phase === "address" && (
        <div className="animate-fade-slide-in">
          <AddressSelectionScreen
            onBack={() => setPhase("slot")}
            onContinue={async (addr) => {
              const segmentId = selectedService?.segment_id ?? null;
              try {
                const res = await checkServiceability(
                  addr.latitude,
                  addr.longitude,
                  segmentId,
                );
                if (!res.serviceable) {
                  setNotServiceable({
                    segmentId,
                    latitude: Number(addr.latitude ?? 0),
                    longitude: Number(addr.longitude ?? 0),
                    addressText: addr.full_address,
                    area: addr.area,
                    city: addr.city,
                  });
                  setPhase("not-serviceable");
                  return;
                }
              } catch {
                // If the check itself fails, don't block the booking.
              }
              setSelectedAddress(addr);
              setPhase("summary");
            }}
          />
        </div>
      )}
      {phase === "not-serviceable" && notServiceable && (
        <div className="animate-fade-slide-in">
          <NotServiceableScreen
            location={notServiceable}
            segmentName={selectedService?.segment_name ?? null}
            onBack={() => setPhase("address")}
            onChangeAddress={() => setPhase("address")}
          />
        </div>
      )}
      {phase === "summary" && selectedService && selectedSlot && selectedAddress && (
        <div className="animate-fade-slide-in">
          <BookingSummaryScreen
            service={selectedService}
            slot={selectedSlot}
            address={selectedAddress}
            onBack={() => setPhase("address")}
            onEditAddress={() => setPhase("address")}
            onProceedToPay={() => setPhase("payment")}
          />
        </div>
      )}
      {phase === "payment" && selectedService && selectedSlot && selectedAddress && (
        <div className="animate-fade-slide-in">
          <PaymentScreen
            service={selectedService}
            slot={selectedSlot}
            address={selectedAddress}
            onBack={() => setPhase("summary")}
            onDone={resetAndGoHome}
            onTrackBooking={(id) => {
              setActiveBookingId(id);
              setActiveBookingStatus("accepted");
              setPhase("searching-expert");
            }}
          />
        </div>
      )}
      {phase === "searching-expert" && selectedAddress && (
        <div className="animate-fade-slide-in">
          <SearchingForExpertScreen
            bookingId={activeBookingId}
            address={selectedAddress}
            service={selectedService}
            slot={selectedSlot}
            currentStatus={activeBookingStatus ?? undefined}
            onExpertAssigned={() => {
              setActiveBookingStatus("expert_assigned");
              setPhase("expert-assigned");
            }}
            onCancelled={() => {
              toast("This booking was cancelled");
              resetAndGoHome();
            }}
          />
        </div>
      )}
      {phase === "expert-assigned" && selectedAddress && (
        <div className="animate-fade-slide-in">
          <ExpertAssignedScreen
            bookingId={activeBookingId}
            address={selectedAddress}
            currentStatus={activeBookingStatus ?? undefined}
            onShowStartOtp={() => setPhase("otp-start")}
            onAdvanceInProgress={() => {
              setActiveBookingStatus("in_progress");
              setPhase("in-progress");
            }}
            onAdvanceCompleted={() => {
              setActiveBookingStatus("completed");
              setPhase("rate-review");
            }}
            onCancelled={() => {
              toast("This booking was cancelled");
              resetAndGoHome();
            }}
          />
        </div>
      )}
      {phase === "otp-start" && (
        <div className="animate-fade-slide-in">
          <OtpScreen
            bookingId={activeBookingId}
            kind="start"
            onVerified={() => setPhase("in-progress")}
          />
        </div>
      )}
      {phase === "in-progress" && (
        <div className="animate-fade-slide-in">
          <ServiceInProgressScreen
            bookingId={activeBookingId}
            address={selectedAddress}
            onShowEndOtp={() => setPhase("otp-end")}
            onAdvanceCompleted={() => {
              setActiveBookingStatus("completed");
              setPhase("rate-review");
            }}
            onCancelled={() => {
              toast("This booking was cancelled");
              resetAndGoHome();
            }}
          />
        </div>
      )}
      {phase === "otp-end" && (
        <div className="animate-fade-slide-in">
          <OtpScreen
            bookingId={activeBookingId}
            kind="end"
            onVerified={() => setPhase("rate-review")}
          />
        </div>
      )}
      {phase === "rate-review" && (
        <div className="animate-fade-slide-in">
          <RateReviewScreen
            bookingId={activeBookingId}
            onSubmit={resetAndGoHome}
          />
        </div>
      )}
      {phase === "my-bookings" && (
        <div className="animate-fade-slide-in">
          <MyBookingsScreen
            onBack={() => setPhase("profile")}
            onGoHome={() => setPhase("home")}
            onOpenBooking={(b) => {
              if (ACTIVE_TRACKING_STATUSES.includes(b.status)) {
                const addr = b.addresses;
                if (addr) {
                  setSelectedAddress({
                    id: b.address_id ?? "",
                    label: addr.label,
                    full_address: addr.full_address,
                    area: addr.area,
                    city: addr.city,
                    is_default: addr.is_default,
                    latitude: addr.latitude,
                    longitude: addr.longitude,
                  });
                }
                setActiveBookingId(b.id);
                setActiveBookingStatus(b.status);
                if (b.status === "in_progress") {
                  setPhase("in-progress");
                } else if (b.status === "confirmed" || b.status === "accepted") {
                  setPhase("searching-expert");
                } else {
                  setPhase("expert-assigned");
                }
                return;
              }
              setSelectedBooking(b);
              setPhase("booking-details");
            }}
          />
        </div>
      )}
      {phase === "booking-details" && selectedBooking && (
        <div className="animate-fade-slide-in">
          <BookingDetailsScreen
            booking={selectedBooking}
            onBack={() => setPhase("orders")}
          />
        </div>
      )}
      {phase === "profile" && (
        <div className="animate-fade-slide-in">
          <ProfileScreen
            onBack={() => setPhase("home")}
            onOpenBookings={() => setPhase("my-bookings")}
            onOpenWallet={() => setPhase("wallet")}
            onOpenEditProfile={() => setPhase("edit-profile")}
            onOpenNotifications={() => setPhase("notifications")}
            onOpenSettings={() => setPhase("settings")}
            onOpenHelp={() => setPhase("help")}
            onOpenReferrals={() => setPhase("referrals")}
            onOpenPaymentMethods={() => setPhase("payment-methods")}
            onOpenAddresses={() => setPhase("manage-addresses")}
            onLogout={() => setPhase("login")}
          />
        </div>
      )}
      {phase === "manage-addresses" && (
        <div className="animate-fade-slide-in">
          <AddressSelectionScreen manage onBack={() => setPhase("profile")} />
        </div>
      )}
      {phase === "payment-methods" && (
        <div className="animate-fade-slide-in">
          <PaymentMethodsScreen onBack={() => setPhase("profile")} />
        </div>
      )}
      {phase === "search-results" && (
        <div className="animate-fade-slide-in">
          <SearchResultsScreen
            query={searchQuery}
            onBack={() => setPhase("home")}
            onBookService={(s) => {
              setSelectedService(s);
              setPhase("slot");
            }}
          />
        </div>
      )}

      {phase === "orders" && (
        <div className="animate-fade-slide-in">
          <OrdersScreen
            onOpenHome={() => setPhase("home")}
            onOpenRewards={() => setPhase("rewards")}
            onOpenBooking={(b) => {
              if (ACTIVE_TRACKING_STATUSES.includes(b.status)) {
                const addr = b.addresses;
                if (addr) {
                  setSelectedAddress({
                    id: b.address_id ?? "",
                    label: addr.label,
                    full_address: addr.full_address,
                    area: addr.area,
                    city: addr.city,
                    is_default: addr.is_default,
                    latitude: addr.latitude,
                    longitude: addr.longitude,
                  });
                }
                setActiveBookingId(b.id);
                setActiveBookingStatus(b.status);
                if (b.status === "in_progress") {
                  setPhase("in-progress");
                } else if (b.status === "confirmed" || b.status === "accepted") {
                  setPhase("searching-expert");
                } else {
                  setPhase("expert-assigned");
                }
                return;
              }
              setSelectedBooking(b);
              setPhase("booking-details");
            }}
          />
        </div>
      )}

      {phase === "referrals" && (
        <div className="animate-fade-slide-in">
          <ReferralDashboardScreen onBack={() => setPhase("profile")} />
        </div>
      )}
      {phase === "wallet" && (
        <div className="animate-fade-slide-in">
          <WalletScreen onBack={() => setPhase("profile")} />
        </div>
      )}
      {phase === "rewards" && (
        <div className="animate-fade-slide-in">
          <RewardsScreen
            onOpenHome={() => setPhase("home")}
            onOpenRewards={() => setPhase("rewards")}
            onOpenReferrals={() => setPhase("referrals")}
            onOpenBookings={() => setPhase("orders")}
          />

        </div>
      )}
      {phase === "edit-profile" && (
        <div className="animate-fade-slide-in">
          <EditProfileScreen onBack={() => setPhase("profile")} />
        </div>
      )}
      {phase === "notifications" && (
        <div className="animate-fade-slide-in">
          <NotificationsScreen onBack={() => setPhase("profile")} />
        </div>
      )}
      {phase === "settings" && (
        <div className="animate-fade-slide-in">
          <SettingsScreen
            onBack={() => setPhase("profile")}
            onOpenNotifications={() => setPhase("notifications")}
            onOpenDevices={() => setPhase("active-devices")}
            onOpenLanguage={() => setPhase("language")}
          />
        </div>
      )}
      {phase === "help" && (
        <div className="animate-fade-slide-in">
          <HelpSupportScreen
            onBack={() => setPhase("profile")}
            onOpenLegal={(slug) => {
              setLegal({ slug, from: "help" });
              setPhase("legal");
            }}
            onOpenAbout={() => setPhase("about")}
          />
        </div>
      )}
      {phase === "active-devices" && (
        <div className="animate-fade-slide-in">
          <ActiveDevicesScreen
            onBack={() => setPhase("settings")}
            onSignedOut={() => setPhase("login")}
          />
        </div>
      )}
      {phase === "language" && (
        <div className="animate-fade-slide-in">
          <LanguageScreen onBack={() => setPhase("settings")} />
        </div>
      )}
      {phase === "device-limit" && (
        <div className="animate-fade-slide-in">
          <DeviceLimitScreen
            devices={limitDevices}
            onContinue={() => setPhase("home")}
            onCancel={() => setPhase("login")}
          />
        </div>
      )}
      {phase === "legal" && legal && (
        <div className="animate-fade-slide-in">
          <LegalPageScreen slug={legal.slug} onBack={() => setPhase(legal.from)} />
        </div>
      )}
      {phase === "about" && (
        <div className="animate-fade-slide-in">
          <AboutScreen onBack={() => setPhase("help")} />
        </div>
      )}
    </div>
  );
}
