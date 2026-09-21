import { getAuthUser } from "@/lib/authUser";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, LocateFixed, MapPin, Plus, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AddAddressMapScreen, type PickedAddress } from "./AddAddressMapScreen";
import {
  endSearchSession,
  resolveSuggestion,
  searchPlaceSuggestions,
  type AddressSuggestion,
} from "@/lib/addressSearch";
import { PlaceSuggestionList } from "./PlaceSuggestionList";
import { useT } from "@/i18n";
import {
  getCurrentCoords,
  openAppSettings,
  LocationPermissionError,
} from "@/lib/nativeGeolocation";
import { toast } from "sonner";
import { pushBackHandler } from "@/lib/backHandler";


export type SavedAddress = {
  id: string;
  label: string | null;
  full_address: string;
  area: string | null;
  city: string | null;
  is_default: boolean | null;
};

async function fetchAddresses(): Promise<SavedAddress[]> {
  const { data: userData } = await getAuthUser();
  const uid = userData.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, full_address, area, city, is_default")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedAddress[];
}

export function LocationPickerSheet({
  open,
  activeId,
  onClose,
  onSelect,
}: {
  open: boolean;
  activeId: string | null;
  onClose: () => void;
  onSelect: (a: SavedAddress) => void;
}) {
  const qc = useQueryClient();
  const [showMap, setShowMap] = useState(false);
  /** Where the map picker should start (search hit or GPS position). */
  const [mapPoint, setMapPoint] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const { data: addresses = [], isLoading } = useQuery({
    queryKey: ["addresses"],
    queryFn: fetchAddresses,
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setShowMap(false);
      setMapPoint(null);
      setQuery("");
      setResults([]);
      setSearchError(null);
      setLocError(null);
    }
  }, [open]);

  // Native back closes the map layer first, then the sheet itself.
  useEffect(() => {
    if (!open) return;
    if (showMap) return pushBackHandler(() => setShowMap(false));
    return pushBackHandler(() => onClose());
  }, [open, showMap, onClose]);

  // Live place search (Geocoding API) alongside the saved-address filter.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 3) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      endSearchSession();
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      searchPlaceSuggestions(q)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setSearchError(r.length === 0 ? t("search.noResults") : null);
        })
        .catch((e) => {
          if (cancelled) return;
          console.error("[address] search failed:", e);
          setResults([]);
          setSearchError(t("search.failed"));
        })
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, t]);

  const handlePickSuggestion = (s: AddressSuggestion) => {
    setResolvingId(s.id);
    resolveSuggestion(s)
      .then((p) => openMapAt({ lat: p.lat, lng: p.lng }))
      .catch((e) => {
        console.error("[address] place details failed:", e);
        toast.error(t("search.detailFailed"));
      })
      .finally(() => setResolvingId(null));
  };

  const addMutation = useMutation({
    mutationFn: async (input: PickedAddress) => {
      const { data: userData } = await getAuthUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("Please sign in to save an address.");
      await supabase.from("users").upsert({ id: uid }, { onConflict: "id" });

      const { data, error } = await supabase
        .from("addresses")
        .insert({
          user_id: uid,
          label: input.label,
          full_address: input.full_address,
          area: input.area,
          city: input.city ?? undefined,
          pincode: input.pincode ?? undefined,
          latitude: input.latitude,
          longitude: input.longitude,
          is_default: addresses.length === 0,
        })
        .select("id, label, full_address, area, city, is_default")
        .single();
      if (error) throw error;
      const created = data as SavedAddress;

      if (input.photo) {
        const ext = (input.photo.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${uid}/${created.id}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("address-photos")
          .upload(path, input.photo, {
            upsert: true,
            contentType: input.photo.type || "image/jpeg",
          });
        if (!upErr) {
          const { data: pub } = supabase.storage
            .from("address-photos")
            .getPublicUrl(path);
          await supabase
            .from("addresses")
            .update({ landmark_photo_url: pub.publicUrl })
            .eq("id", created.id);
        }
      }
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["addresses"] });
      setShowMap(false);
      setMapPoint(null);
      onSelect(created);
    },
  });

  const openMapAt = (point: { lat: number; lng: number } | null) => {
    setMapPoint(point);
    setShowMap(true);
  };

  // Current location no longer creates a throwaway address — it opens the map
  // picker at the customer's position so the address is actually saved.
  const handleUseCurrentLocation = async () => {
    setLocError(null);
    setLocLoading(true);
    try {
      const coords = await getCurrentCoords();
      openMapAt({ lat: coords.lat, lng: coords.lng });
    } catch (e) {
      console.error("[location] current location failed:", e);
      if (e instanceof LocationPermissionError) {
        setLocError("Location permission needed to detect your address.");
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
        setLocError((e as Error).message || "Could not resolve location.");
      }
    } finally {
      setLocLoading(false);
    }
  };

  if (!open) return null;

  if (showMap) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <AddAddressMapScreen
          initialPoint={mapPoint}
          onBack={() => {
            setShowMap(false);
            setMapPoint(null);
          }}
          onSave={(a) => addMutation.mutate(a)}
          isSaving={addMutation.isPending}
          error={addMutation.error ? (addMutation.error as Error).message : null}
        />
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? addresses.filter((a) =>
        [a.label, a.full_address, a.area, a.city]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q)),
      )
    : addresses;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        className="flex-1 bg-black/40"
        onClick={onClose}
      />
      <div className="mx-auto flex h-[85vh] max-h-[85vh] w-full max-w-md flex-col rounded-t-[24px] bg-card p-5 pb-[calc(var(--app-safe-bottom)+24px)] shadow-lg animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto h-1.5 w-10 rounded-full bg-border" />
        <div className="mt-4 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-foreground">
            Select delivery location
          </h2>
          <button
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"
          >
            <X className="h-4 w-4 text-foreground" />
          </button>
        </div>

        {/* Search */}
        <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-border bg-background px-3 py-2.5">
          {searching ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground" />
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="mt-3 space-y-2">
          <button
            onClick={handleUseCurrentLocation}
            disabled={locLoading}
            className="flex w-full items-start gap-3 rounded-[14px] border border-border bg-card p-3 text-left transition active:scale-[0.99] disabled:opacity-60"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              {locLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <LocateFixed className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-primary">
                Use current location
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {locError ?? "Get your exact location automatically"}
              </div>
            </div>
          </button>

          <button
            onClick={() => openMapAt(null)}
            className="flex w-full items-center gap-3 rounded-[14px] border border-dashed border-primary/60 bg-primary/5 p-3 text-left transition active:scale-[0.99]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <Plus className="h-4 w-4 text-primary" />
            </div>
            <div className="text-sm font-bold text-primary">Add New Address</div>
          </button>
        </div>

        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* Live search results */}
            {q.length >= 3 && (
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t("search.results")}
                </div>
                <div className="mt-2 overflow-hidden rounded-[16px] border border-border bg-card">
                  <PlaceSuggestionList
                    suggestions={results}
                    searching={searching}
                    message={searchError}
                    busyId={resolvingId}
                    onPick={handlePickSuggestion}
                  />
                </div>
              </div>
            )}

            {/* Saved */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Your saved addresses
              </div>
              <div className="mt-2 space-y-2">
                {isLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Loading…
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {addresses.length === 0
                      ? "No saved addresses yet"
                      : "No saved addresses match your search"}
                  </p>
                ) : (
                  filtered.map((a) => {
                    const active = a.id === activeId;
                    return (
                      <button
                        key={a.id}
                        onClick={() => onSelect(a)}
                        className={`flex w-full items-start gap-3 rounded-[16px] border p-3 text-left transition ${
                          active
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card"
                        }`}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <MapPin className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-foreground">
                            {a.label ?? "Address"}
                          </div>
                          <div className="line-clamp-2 text-xs text-muted-foreground">
                            {a.full_address}
                          </div>
                        </div>
                        {active && (
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
                            <Check className="h-3.5 w-3.5 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
