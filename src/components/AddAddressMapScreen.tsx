import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Crosshair, Loader2, MapPin, Search, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  searchPlaces,
  getPlaceDetails,
  type PlaceSuggestion,
} from "@/lib/geocode.functions";
import { resolveAddress } from "@/lib/reverseGeocode";
import {
  getCurrentCoords,
  openAppSettings,
  LocationPermissionError,
} from "@/lib/nativeGeolocation";
import { loadMapsScript } from "@/lib/googleMapsLoader";
import { browserReverseGeocode } from "@/lib/browserGeocode";


export type PickedAddress = {
  full_address: string;
  area: string | null;
  city: string | null;
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
}: {
  onBack: () => void;
  onSave: (a: PickedAddress) => void;
  isSaving: boolean;
  error: string | null;
  initial?: EditableAddress | null;
}) {
  const initialSplit = initial ? splitExisting(initial.full_address) : null;
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [center, setCenter] = useState<LatLng>(
    initial?.latitude != null && initial?.longitude != null
      ? { lat: Number(initial.latitude), lng: Number(initial.longitude) }
      : DEFAULT_CENTER,
  );
  const [mapReady, setMapReady] = useState(false);
  const [autoAddress, setAutoAddress] = useState(initialSplit?.rest ?? "");
  const [area, setArea] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [addressDetails, setAddressDetails] = useState(
    initialSplit?.details ?? "",
  );
  const [label, setLabel] = useState<(typeof LABELS)[number]>(
    (LABELS.find((l) => l === initial?.label) ?? "Home") as (typeof LABELS)[number],
  );
  const [editingAuto, setEditingAuto] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const placeSearch = useServerFn(searchPlaces);
  const placeDetails = useServerFn(getPlaceDetails);
  const centerRef = useRef(center);
  centerRef.current = center;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const skipGeocodeRef = useRef(false);
  const [geocodeNonce, setGeocodeNonce] = useState(0);


  // Debounced place autocomplete
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      placeSearch({ data: { query: q, lat: centerRef.current.lat, lng: centerRef.current.lng } })
        .then((r) => !cancelled && setSuggestions(r))
        .catch((e) => {
          if (cancelled) return;
          console.error("Place search failed:", e);
          setSuggestions([]);
        })
        .finally(() => !cancelled && setSearching(false));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setSearching(false);
    };
  }, [query, placeSearch]);

  const handleSelectSuggestion = async (s: PlaceSuggestion) => {
    setSuggestions([]);
    setQuery(s.primary);
    try {
      const d = await placeDetails({ data: { placeId: s.placeId } });
      const next = { lat: d.latitude, lng: d.longitude };
      skipGeocodeRef.current = true;
      if (mapRef.current) mapRef.current.panTo(next);
      setCenter(next);
      setGeocodeFailed(false);
      setAutoAddress(d.formatted_address || [s.primary, s.secondary].filter(Boolean).join(", "));
    } catch (e) {
      console.error("Place details failed:", e);
    }
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
          if (!fromPlace) setAutoAddress(outcome.result.formatted_address);
          setArea(outcome.result.area);
          setCity(outcome.result.city);
        } else {
          if (!fromPlace) {
            setAutoAddress("");
            setGeocodeFailed(true);
            setGeocodeError(outcome.error);
            toast.error("Couldn't fetch the address for this pin.", {
              description: outcome.error.slice(0, 140),
              action: {
                label: "Retry",
                onClick: () => setGeocodeNonce((n) => n + 1),
              },
            });
          }
          setArea(null);
          setCity(null);
        }
        setGeocoding(false);
      })();
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [center, geocodeNonce]);


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
        const msg =
          (err as Error)?.message || "Couldn't detect your location.";
        if (err instanceof LocationPermissionError) {
          toast.error("Location permission needed to detect your address", {
            action: {
              label: "Open settings",
              onClick: () => {
                void openAppSettings().then((ok) => {
                  if (!ok)
                    toast.info(
                      "Enable Location for badiyos in your phone's app settings.",
                    );
                });
              },
            },
          });
        } else {
          toast.error(msg);
        }
      })
      .finally(() => setLocating(false));

  };

  const canSave = addressDetails.trim().length > 0 && !isSaving;

  const handleSave = () => {
    if (!canSave) return;
    const full = autoAddress.trim()
      ? `${addressDetails.trim()}, ${autoAddress.trim()}`
      : addressDetails.trim();
    onSave({
      full_address: full,
      area,
      city,
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
    <div className="fixed inset-0 z-30 flex flex-col bg-background">
      {/* Map area */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapDivRef} className="absolute inset-0 bg-muted" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading map…
          </div>
        )}

        {/* Top search overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-4">
          <div className="mx-auto flex w-full max-w-md items-center gap-2">
            <button
              onClick={onBack}
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
                  placeholder="Search for area, street name..."
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
              {suggestions.length > 0 && (
                <ul className="absolute inset-x-0 top-full z-20 mt-2 max-h-64 overflow-y-auto rounded-[14px] border border-border bg-card shadow-lg">
                  {suggestions.map((s) => (
                    <li key={s.placeId}>
                      <button
                        type="button"
                        onClick={() => handleSelectSuggestion(s)}
                        className="flex w-full items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0 active:bg-muted"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {s.primary}
                          </span>
                          {s.secondary && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {s.secondary}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

        </div>

        {/* Center pin */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
          <MapPin className="h-10 w-10 text-primary drop-shadow" strokeWidth={2.5} fill="currentColor" />
        </div>

        {/* Use current location */}
        <button
          onClick={useCurrentLocation}
          className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-bold text-primary shadow-md active:scale-[0.98]"
        >
          <Crosshair className="h-4 w-4" />
          {locating ? "Locating…" : "Use current location"}
        </button>
      </div>

      {/* Bottom sheet */}
      <div className="rounded-t-[24px] border-t border-border bg-card p-5 pb-6 shadow-2xl">
        <div className="mx-auto w-full max-w-md space-y-4">
          <div>
            <div className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Delivery details
            </div>
            {editingAuto ? (
              <textarea
                autoFocus
                value={autoAddress}
                onChange={(e) => setAutoAddress(e.target.value)}
                onBlur={() => setEditingAuto(false)}
                rows={2}
                className="w-full rounded-[14px] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            ) : (
              <button
                onClick={() => setEditingAuto(true)}
                className="flex w-full items-start gap-2 rounded-[14px] border border-border bg-background px-3 py-2.5 text-left"
              >
                {geocoding ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                ) : (
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <span
                  className={`flex-1 text-sm ${
                    geocoding || (!autoAddress && !geocodeFailed)
                      ? "text-muted-foreground"
                      : geocodeFailed && !autoAddress
                        ? "text-red-600"
                        : "text-foreground"
                  }`}
                >
                  {geocoding
                    ? "Finding address…"
                    : autoAddress
                      ? autoAddress
                      : geocodeFailed
                        ? "Unable to fetch address, please enter manually"
                        : "Move the pin to select a location"}
                </span>
              </button>
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
