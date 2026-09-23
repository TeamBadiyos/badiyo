import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Crosshair,
  Loader2,
  Lock,
  MapPin,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  endSearchSession,
  resolveSuggestion,
  searchPlaceSuggestions,
  type AddressSuggestion,
} from "@/lib/addressSearch";
import { PlaceSuggestionList } from "./PlaceSuggestionList";
import { pushBackHandler } from "@/lib/backHandler";
import { useT } from "@/i18n";
import { resolveAddress } from "@/lib/reverseGeocode";
import {
  getCurrentCoords,
  LocationDisabledError,
  LocationPermissionError,
} from "@/lib/nativeGeolocation";
import {
  LocationHelpDialog,
  type LocationHelpKind,
} from "./LocationHelpDialog";
import { loadMapsScript } from "@/lib/googleMapsLoader";
import {
  checkCourierServiceability,
  checkServiceability,
} from "@/lib/serviceability";


export type PickedAddress = {
  full_address: string;
  area: string | null;
  city: string | null;
  pincode: string | null;
  latitude: number;
  longitude: number;
  label: string;
  address_details: string;
  photo: File | null;
};

/** Existing address being edited (map picker doubles as the edit flow). */
export type EditableAddress = {
  id: string;
  label: string | null;
  full_address: string;
  latitude: number | null;
  longitude: number | null;
};

type LatLng = { lat: number; lng: number };

const DEFAULT_CENTER: LatLng = { lat: 18.4088, lng: 76.5604 }; // Latur
const LABELS = ["Home", "Work", "Other"] as const;

function splitExisting(full: string): { details: string; rest: string } {
  const i = full.indexOf(",");
  if (i === -1) return { details: full.trim(), rest: "" };
  return { details: full.slice(0, i).trim(), rest: full.slice(i + 1).trim() };
}

export function AddAddressMapScreen({
  onBack,
  onSave,
  isSaving,
  error,
  initial = null,
  initialPoint = null,
  serviceCheck = "home",
  segmentId = null,
}: {
  onBack: () => void;
  onSave: (a: PickedAddress) => void;
  isSaving: boolean;
  error: string | null;
  initial?: EditableAddress | null;
  /** Start the pin here (e.g. the customer's current GPS position). */
  initialPoint?: LatLng | null;
  serviceCheck?: "home" | "courier";
  segmentId?: string | null;
}) {
  const t = useT();
  const initialSplit = initial ? splitExisting(initial.full_address) : null;
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [center, setCenter] = useState<LatLng>(
    initial?.latitude != null && initial?.longitude != null
      ? { lat: Number(initial.latitude), lng: Number(initial.longitude) }
      : (initialPoint ?? DEFAULT_CENTER),
  );
  const [mapReady, setMapReady] = useState(false);
  const [autoAddress, setAutoAddress] = useState(initialSplit?.rest ?? "");
  const [area, setArea] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [pincode, setPincode] = useState<string | null>(null);
  const [addressDetails, setAddressDetails] = useState(
    initialSplit?.details ?? "",
  );
  const [label, setLabel] = useState<(typeof LABELS)[number]>(
    (LABELS.find((l) => l === initial?.label) ?? "Home") as (typeof LABELS)[number],
  );
  const [locating, setLocating] = useState(false);
  const [locHelp, setLocHelp] = useState<LocationHelpKind>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [zoneState, setZoneState] = useState<"idle" | "checking" | "in" | "out">(
    "idle",
  );

  const centerRef = useRef(center);
  centerRef.current = center;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const skipGeocodeRef = useRef(false);
  // True right after a suggestion is tapped: keeps the dropdown closed until
  // the customer types again (filling the box must not re-open the list).
  const justPickedRef = useRef(false);
  const [picked, setPicked] = useState(false);
  const [geocodeNonce, setGeocodeNonce] = useState(0);

  // Debounced place search: Google Places first (shop / hospital names with
  // distance), Geocoding as the fallback. Minimum 3 characters, 300ms idle.
  useEffect(() => {
    const q = query.trim();
    if (justPickedRef.current) {
      justPickedRef.current = false;
      setSuggestions([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    if (q.length < 3) {
      setSuggestions([]);
      setSearching(false);
      setSearchError(null);
      endSearchSession();
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      searchPlaceSuggestions(q, centerRef.current)
        .then((r) => {
          if (cancelled) return;
          setSuggestions(r);
          setSearchError(r.length === 0 ? t("search.noResults") : null);
        })
        .catch((e) => {
          if (cancelled) return;
          console.error("[address] search failed:", e);
          setSuggestions([]);
          setSearchError(t("search.failed"));
        })
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setSearching(false);
    };
  }, [query, t]);

  const handleSelectSuggestion = (s: AddressSuggestion) => {
    setResolvingId(s.id);
    justPickedRef.current = true;
    setPicked(true);
    setSuggestions([]);
    setSearchError(null);
    setSearching(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
    resolveSuggestion(s)
      .then((p) => {
        setSuggestions([]);
        setSearchError(null);
        justPickedRef.current = true;
        setQuery(s.title);
        const next = { lat: p.lat, lng: p.lng };
        if (mapRef.current) mapRef.current.panTo(next);
        setCenter(next);
        setGeocodeFailed(false);
      })
      .catch((e) => {
        console.error("[address] place details failed:", e);
        toast.error(t("search.detailFailed"));
      })
      .finally(() => setResolvingId(null));
  };


  // Init map
  useEffect(() => {
    let cancelled = false;
    loadMapsScript()
      .then(() => {
        if (cancelled || !mapDivRef.current || !window.google) return;
        const map = new window.google.maps.Map(mapDivRef.current, {
          center: centerRef.current,
          zoom: 16,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: {
            position: window.google.maps.ControlPosition.LEFT_BOTTOM,
          },
          clickableIcons: false,
        });
        mapRef.current = map;
        setMapReady(true);
        map.addListener("idle", () => {
          const c = map.getCenter();
          if (!c) return;
          const next = { lat: c.lat(), lng: c.lng() };
          const prev = centerRef.current;
          if (
            Math.abs(prev.lat - next.lat) < 1e-6 &&
            Math.abs(prev.lng - next.lng) < 1e-6
          )
            return;
          console.info("[address] pin moved to", next);
          setCenter(next);
        });
      })
      .catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, []);

  // Reverse geocode when the map center settles (debounced to coalesce rapid
  // idles). Runs through resolveAddress(): stable HTTP route first, Maps JS
  // Geocoder as fallback, both time-boxed. Deps intentionally exclude the
  // server-fn identities — anything unstable there would clear the debounce
  // timer on every render and the request would never fire.
  useEffect(() => {
    let cancelled = false;
    const fromPlace = skipGeocodeRef.current;
    skipGeocodeRef.current = false;
    const t = setTimeout(() => {
      void (async () => {
        setGeocoding(true);
        setGeocodeFailed(false);
        setGeocodeError(null);
        console.info("[address] reverse geocode request", center);
        const outcome = await resolveAddress(center);
        if (cancelled) return;
        if (outcome.ok) {
          setAutoAddress(outcome.result.formatted_address);
          setArea(outcome.result.area);
          setCity(outcome.result.city);
          setPincode(outcome.result.pincode);
        } else {
          setAutoAddress("");
          setGeocodeFailed(true);
          setGeocodeError(outcome.error);
          if (!fromPlace) {
            toast.error("Couldn't fetch the address for this pin.", {
              action: {
                label: "Retry",
                onClick: () => setGeocodeNonce((n) => n + 1),
              },
            });
          }
          setArea(null);
          setCity(null);
          setPincode(null);
        }
        setGeocoding(false);
      })();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [center, geocodeNonce]);

  // Live serviceability for the current pin, so the user is told before they
  // fill the whole form. A failed check never blocks saving.
  useEffect(() => {
    let cancelled = false;
    setZoneState("checking");
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res =
            serviceCheck === "courier"
              ? await checkCourierServiceability(center.lat, center.lng)
              : await checkServiceability(center.lat, center.lng, segmentId);
          if (cancelled) return;
          setZoneState(res.serviceable ? "in" : "out");
        } catch (e) {
          console.error("[address] zone check failed:", e);
          if (!cancelled) setZoneState("idle");
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [center, serviceCheck, segmentId]);

  const useCurrentLocation = () => {
    if (locating) return;
    setLocating(true);
    console.info("[address] requesting current location");
    getCurrentCoords()
      .then((c) => {
        console.info("[address] got coords", c);
        if (mapRef.current) mapRef.current.panTo(c);
        setCenter(c);
      })
      .catch((err: unknown) => {
        console.error("[address] location failed:", err);
        if (err instanceof LocationPermissionError) {
          setLocHelp("denied");
        } else if (err instanceof LocationDisabledError) {
          setLocHelp("disabled");
        } else {
          toast.error(
            (err as Error)?.message || "Couldn't detect your location.",
          );
        }
      })
      .finally(() => setLocating(false));
  };

  // Only the parcel flow needs a hard zone gate; saving/editing a personal
  // address anywhere else stays possible, with just a warning.
  const blockOutsideZone = serviceCheck === "courier";

  const canSave =
    addressDetails.trim().length > 0 &&
    autoAddress.trim().length > 0 &&
    !geocoding &&
    (!blockOutsideZone || zoneState !== "out") &&
    !isSaving;
  const searchResultsOpen =
    !picked &&
    query.trim().length >= 3 &&
    (suggestions.length > 0 || searching || searchError != null);

  // Back (screen arrow or the phone's back gesture) first dismisses the
  // search overlay so the map, pin and form come back cleanly; only a second
  // back leaves the screen.
  const closeSearch = () => {
    justPickedRef.current = false;
    setPicked(false);
    setQuery("");
    setSuggestions([]);
    setSearchError(null);
    setSearching(false);
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const searchActive = searchResultsOpen || query.trim().length > 0;
  const handleBack = () => {
    if (searchActive) {
      closeSearch();
      return;
    }
    onBack();
  };
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;
  // The native stack pops the handler once it runs, so re-register whenever
  // the search state changes (closing search must not close the screen).
  useEffect(
    () => pushBackHandler(() => handleBackRef.current()),
    [searchActive],
  );

  const handleSave = () => {
    if (!canSave) return;
    const full = `${addressDetails.trim()}, ${autoAddress.trim()}`;
    onSave({
      full_address: full,
      area,
      city,
      pincode,
      latitude: center.lat,
      longitude: center.lng,
      label,
      address_details: addressDetails.trim(),
      photo,
    });
  };

  const handlePhotoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(f);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(URL.createObjectURL(f));
    e.target.value = "";
  };

  const removePhoto = () => {
    setPhoto(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
  };

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-background pb-[var(--app-safe-bottom)]">
      <LocationHelpDialog kind={locHelp} onClose={() => setLocHelp(null)} />
      {/* Map area */}
      {/* Map takes the top 70% of the screen so the pin is easy to see and move. */}
      <div className="relative h-[70dvh] shrink-0">

        <div ref={mapDivRef} className="absolute inset-0 bg-muted" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading map…
          </div>
        )}

        {/* Top search overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--app-safe-top)+var(--app-address-top-gap))] z-30 px-4 pb-4">
          <div className="mx-auto flex w-full max-w-md items-center gap-2">
            <button
              onClick={handleBack}
              aria-label="Back"
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm"
            >
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </button>
            <div className="pointer-events-auto relative flex-1">
              <div className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-3 py-2.5 shadow-sm">
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Search className="h-4 w-4 text-muted-foreground" />
                )}
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("search.placeholder")}
                  className="flex-1 bg-transparent text-sm text-foreground outline-none"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQuery("");
                      setSuggestions([]);
                    }}
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
              {searchResultsOpen && (
                <div className="absolute inset-x-0 top-full z-40 mt-2 max-h-[min(18rem,42dvh)] overflow-y-auto rounded-[14px] border border-border bg-card shadow-lg">
                  <PlaceSuggestionList
                    suggestions={suggestions}
                    searching={searching}
                    message={searchError}
                    busyId={resolvingId}
                    onPick={handleSelectSuggestion}
                  />
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Center pin */}
        <div
          aria-hidden={searchResultsOpen}
          className={`pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full transition-opacity ${
            searchResultsOpen ? "opacity-0" : "opacity-100"
          }`}
        >
          <MapPin className="h-10 w-10 text-primary drop-shadow" strokeWidth={2.5} fill="currentColor" />
        </div>

        {/* Use current location */}
        <button
          onClick={useCurrentLocation}
          className={`absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-primary shadow-md transition-opacity active:scale-[0.98] ${
            searchResultsOpen ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <Crosshair className="h-4 w-4" />
          {locating ? "Locating…" : "Use current location"}
        </button>
      </div>

      {/* Bottom sheet */}
      <div className="relative z-20 -mt-4 flex-1 min-h-0 overflow-y-auto rounded-t-[24px] border-t border-border bg-card p-5 pb-[calc(var(--app-safe-bottom)+24px)] shadow-2xl">
        <div className="mx-auto w-full max-w-md space-y-4">
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Delivery details
              <Lock className="h-3 w-3" />
            </div>
            <div className="flex w-full items-start gap-2 rounded-[14px] border border-border bg-muted/50 px-3 py-2.5">
              {geocoding ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
              ) : (
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              )}
              <span
                className={`flex-1 text-sm ${
                  geocoding || (!autoAddress && !geocodeFailed)
                    ? "text-muted-foreground"
                    : geocodeFailed
                      ? "text-destructive"
                      : "text-foreground"
                }`}
              >
                {geocoding
                  ? "Finding address…"
                  : autoAddress
                    ? autoAddress
                    : geocodeFailed
                      ? "Could not detect the address for this pin."
                      : "Move the pin to select a location"}
              </span>
            </div>
            {!geocoding && geocodeFailed && (
              <div className="mt-2 space-y-2">
                <button
                  type="button"
                  onClick={() => setGeocodeNonce((n) => n + 1)}
                  className="flex items-center gap-1.5 rounded-[12px] border border-border bg-card px-3 py-2 text-xs font-bold text-primary active:scale-[0.98]"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Tap to retry
                </button>
                <textarea
                  value={autoAddress}
                  onChange={(e) => setAutoAddress(e.target.value)}
                  rows={2}
                  placeholder="Type your area, road and city"
                  className="w-full rounded-[14px] border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  We couldn't detect the address here — type it yourself. The
                  map pin stays where you placed it.
                </p>
              </div>
            )}
            {!geocodeFailed && (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                Detected from the map pin — move the pin or search to change it.
              </p>
            )}

            {/* Live serviceability for this pin */}
            {zoneState === "checking" && (
              <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
                Checking service area…
              </p>
            )}
            {zoneState === "in" && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
                Deliverable area
              </p>
            )}
            {zoneState === "out" && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-destructive">
                <ShieldAlert className="h-3.5 w-3.5" />
                {blockOutsideZone
                  ? "Outside our service area — move the pin inside the city we serve."
                  : "We don't serve this area yet — you can still save this address."}
              </p>
            )}
          </div>


          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Address details
            </span>
            <input
              value={addressDetails}
              onChange={(e) => setAddressDetails(e.target.value)}
              placeholder="Flat / House no, Floor, Building"
              className="w-full rounded-[14px] border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Save as
            </div>
            <div className="flex gap-2">
              {LABELS.map((l) => {
                const active = label === l;
                return (
                  <button
                    key={l}
                    onClick={() => setLabel(l)}
                    className={`rounded-[14px] border px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground"
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Add a photo of your home (optional)
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoPick}
              className="hidden"
            />
            {photoPreview ? (
              <div className="relative h-20 w-20">
                <img
                  src={photoPreview}
                  alt="Home preview"
                  className="h-20 w-20 rounded-[14px] border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={removePhoto}
                  aria-label="Remove photo"
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background shadow"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed border-border bg-background text-primary transition active:scale-[0.98]"
              >
                <Camera className="h-5 w-5" />
                <span className="text-[10px] font-bold">Add photo</span>
              </button>
            )}
          </div>

          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

          <button
            disabled={!canSave}
            onClick={handleSave}
            className={`w-full rounded-[14px] px-4 py-3.5 text-sm font-bold transition ${
              canSave
                ? "bg-primary text-primary-foreground active:scale-[0.99]"
                : "bg-primary/30 text-primary-foreground/70"
            }`}
          >
            {isSaving ? "Saving…" : initial ? "Update Address" : "Save Address"}
          </button>
        </div>
      </div>
    </div>
  );
}
