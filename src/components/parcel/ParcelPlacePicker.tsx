// Rapido-style place picker for Parcel pickup/drop: search, saved & recent
// places, "Select on map" (pin + address form), then name & phone.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, History, Loader2, MapPin, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { useBackHandler } from "@/lib/backHandler";
import { endSearchSession, resolveSuggestion, searchPlaceSuggestions, type AddressSuggestion } from "@/lib/addressSearch";
import type { PickedAddress } from "@/components/AddAddressMapScreen";
import { useParcelCopy } from "./parcelCopy";
import { addrTitle, fetchParcelAddresses, hasCoords, phone10, readRecentDrops, type ParcelAddr } from "./parcelDraft";

const AddAddressMapScreen = lazy(() => import("@/components/AddAddressMapScreen").then((m) => ({ default: m.AddAddressMapScreen })));

export type PickedPlace = { addr: ParcelAddr; name: string; phone: string };

async function fetchMe() {
  const { data: auth } = await getAuthUser();
  const uid = auth.user?.id;
  if (!uid) return { name: "", phone: "" };
  const { data } = await supabase.from("users").select("full_name, phone").eq("id", uid).maybeSingle();
  return { name: data?.full_name?.trim() ?? "", phone: phone10(data?.phone ?? auth.user?.phone ?? "") };
}

function fromPicked(p: PickedAddress): ParcelAddr {
  return {
    id: `map-${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`,
    label: p.address_details?.trim() || null,
    full_address: p.full_address,
    area: p.area,
    city: p.city,
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

export function ParcelPlacePicker({
  kind,
  other,
  initial,
  onClose,
  onDone,
  onAddStops,
  startOnMap,
}: {
  kind: "pickup" | "drop";
  other: ParcelAddr | null;
  initial?: PickedPlace | null;
  onClose: () => void;
  onDone: (p: PickedPlace) => void;
  onAddStops?: () => void;
  startOnMap?: boolean;
}) {
  const c = useParcelCopy();
  const [mapOpen, setMapOpen] = useState(Boolean(startOnMap && !initial?.addr));
  const [chosen, setChosen] = useState<ParcelAddr | null>(initial?.addr ?? null);
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [query, setQuery] = useState("");
  const [sugs, setSugs] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const { data: saved = [] } = useQuery({ queryKey: ["parcel-addresses"], queryFn: fetchParcelAddresses, staleTime: 60_000 });
  const { data: me } = useQuery({ queryKey: ["parcel-me-picker"], queryFn: fetchMe, staleTime: 5 * 60_000, enabled: kind === "pickup" });
  const prefilled = useRef(false);
  useEffect(() => {
    if (kind !== "pickup" || prefilled.current || !me) return;
    prefilled.current = true;
    if (!name) setName(me.name);
    if (!phone) setPhone(me.phone);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  useBackHandler(!mapOpen, () => (chosen && !initial ? setChosen(null) : onClose()));

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSugs([]);
      setSearching(false);
      return;
    }
    let off = false;
    setSearching(true);
    const t = setTimeout(() => {
      const near = other && hasCoords(other) ? { lat: Number(other.latitude), lng: Number(other.longitude) } : { lat: 18.4088, lng: 76.5604 };
      searchPlaceSuggestions(q, near)
        .then((r) => !off && setSugs(r))
        .catch(() => !off && setSugs([]))
        .finally(() => !off && setSearching(false));
    }, 300);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [query, other]);

  const pickSuggestion = async (s: AddressSuggestion) => {
    setResolving(s.id);
    try {
      const p = await resolveSuggestion(s);
      endSearchSession();
      setChosen({ id: `place-${s.id}`, label: s.title, full_address: p.address || [s.title, s.area].filter(Boolean).join(", "), area: s.area || null, city: null, latitude: p.lat, longitude: p.lng });
      setQuery("");
      setSugs([]);
    } catch {
      toast.error("Couldn't open this place. Try another or select on map.");
    } finally {
      setResolving(null);
    }
  };

  const recent = readRecentDrops();
  const list: ParcelAddr[] = [
    ...saved.filter(hasCoords),
    ...recent.filter((r) => !saved.some((s) => s.id === r.id || s.full_address === r.full_address)),
  ];

  const done = () => {
    if (!chosen) return;
    if (!name.trim() || phone10(phone).length !== 10) return toast(kind === "pickup" ? c.needSender : c.needReceiver);
    onDone({ addr: chosen, name: name.trim(), phone: phone10(phone) });
  };

  const dotP = <span className="h-3 w-3 shrink-0 rounded-full border-[3px] border-primary bg-card" />;
  const dotD = <span className="h-3 w-3 shrink-0 rounded-full border-[3px] border-destructive bg-card" />;
  const input = "w-full rounded-[12px] border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto pb-32">
        <div className="flex items-center gap-3 px-4 pt-[calc(var(--app-safe-top,0px)+16px)]">
          <button type="button" onClick={onClose} aria-label="Back" className="flex h-10 w-10 items-center justify-center">
            <ArrowLeft className="h-6 w-6 text-foreground" />
          </button>
          <h1 className="text-2xl font-extrabold text-foreground">{kind === "pickup" ? c.pickup : c.drop}</h1>
        </div>

        {/* Route box */}
        <div className="mx-4 mt-4 rounded-[18px] border border-border bg-surface-soft px-4 py-2">
          {kind === "drop" && other && (
            <div className="flex items-center gap-3 border-b border-border py-3">
              {dotP}
              <span className="truncate text-sm font-semibold text-foreground">{other.full_address}</span>
            </div>
          )}
          <div className="flex items-center gap-3 py-3">
            {kind === "pickup" ? dotP : dotD}
            {chosen ? (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{chosen.full_address}</span>
                <button type="button" onClick={() => setChosen(null)} className="text-xs font-extrabold text-primary">{c.changePlace}</button>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={kind === "pickup" ? c.wherePickup : c.searchPlace}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : query ? (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear"><X className="h-4 w-4 text-muted-foreground" /></button>
                ) : <Search className="h-4 w-4 text-muted-foreground" />}
              </>
            )}
          </div>
          {kind === "pickup" && other && (
            <div className="flex items-center gap-3 border-t border-border py-3">
              {dotD}
              <span className="truncate text-sm font-semibold text-foreground">{other.full_address}</span>
            </div>
          )}
        </div>

        {chosen ? (
          <section className="mx-4 mt-4 rounded-[18px] bg-card p-4 shadow-soft">
            <p className="text-sm font-extrabold text-foreground">{kind === "pickup" ? c.sender : c.receiver}</p>
            <div className="mt-3 grid gap-2.5">
              <input value={name} maxLength={80} placeholder={kind === "pickup" ? c.senderName : c.receiverName} onChange={(e) => setName(e.target.value)} className={input} />
              <input
                value={phone}
                inputMode="numeric"
                maxLength={10}
                placeholder={kind === "pickup" ? c.senderPhone : c.receiverPhone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                className={input}
              />
            </div>
          </section>
        ) : (
          <>
            <div className="mx-4 mt-3 flex gap-3">
              <button type="button" onClick={() => setMapOpen(true)} className="flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold text-foreground">
                <MapPin className="h-4 w-4" /> {c.selectOnMap}
              </button>
              {kind === "drop" && onAddStops && (
                <button type="button" onClick={onAddStops} className="ml-auto flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-bold text-foreground">
                  <Plus className="h-4 w-4" /> {c.addStops}
                </button>
              )}
            </div>
            <div className="mt-3 border-t border-border">
              {(sugs.length ? sugs : []).map((s) => (
                <button key={s.id} type="button" onClick={() => void pickSuggestion(s)} className="flex w-full items-center gap-3 border-b border-dashed border-border px-4 py-3.5 text-left">
                  {resolving === s.id ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold text-foreground">{s.title}</span>
                    <span className="block truncate text-sm text-muted-foreground">{s.area}</span>
                  </span>
                </button>
              ))}
              {!sugs.length && list.map((a) => (
                <button key={a.id + a.full_address} type="button" onClick={() => setChosen(a)} className="flex w-full items-center gap-3 border-b border-dashed border-border px-4 py-3.5 text-left">
                  <History className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold text-foreground">{addrTitle(a)}</span>
                    <span className="block truncate text-sm text-muted-foreground">{a.full_address}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {chosen && (
        <div className="fixed inset-x-0 bottom-0 z-10 bg-card shadow-[0_-4px_16px_rgba(0,0,0,0.06)] safe-bottom">
          <div className="mx-auto w-full max-w-md px-4 py-3">
            <button type="button" onClick={done} className="w-full rounded-[14px] bg-primary py-3.5 text-base font-extrabold text-primary-foreground">
              {c.confirmPlace}
            </button>
          </div>
        </div>
      )}

      {mapOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-50 animate-pulse bg-muted" />}>
          <div className="fixed inset-0 z-50">
            <AddAddressMapScreen
              serviceCheck="courier"
              isSaving={false}
              error={null}
              initialPoint={chosen && hasCoords(chosen) ? { lat: Number(chosen.latitude), lng: Number(chosen.longitude) } : null}
              onBack={() => setMapOpen(false)}
              onSave={(p) => {
                setChosen(fromPicked(p));
                setMapOpen(false);
              }}
            />
          </div>
        </Suspense>
      )}
    </div>
  );
}
