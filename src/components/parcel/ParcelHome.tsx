// Parcel tab home (inside the app shell): map, pickup card, "Where to send?",
// saved/recent chips and the multi-stop link. Booking steps open full-screen.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { LocationPickerSheet, type SavedAddress } from "@/components/LocationPickerSheet";
import { formatNextOpen, useServiceState } from "@/lib/serviceHours";
import { fetchCourierEnabled } from "@/components/courier/courierData";
import { ParcelMap } from "./ParcelMap";
import { fill, useParcelCopy } from "./parcelCopy";
import {
  addrTitle,
  emptyDraft,
  fetchParcelAddresses,
  hasCoords,
  readRecentDrops,
  writeDraft,
  type ParcelAddr,
} from "./parcelDraft";

export function ParcelHome({
  pickup,
  onChangePickup,
  onStart,
}: {
  pickup: SavedAddress | null;
  onChangePickup: () => void;
  onStart: () => void;
}) {
  const c = useParcelCopy();
  const [dropOpen, setDropOpen] = useState(false);
  const [recent, setRecent] = useState<ParcelAddr[]>([]);
  useEffect(() => setRecent(readRecentDrops()), []);
  const { data: enabled = true } = useQuery({ queryKey: ["courier_enabled"], queryFn: () => fetchCourierEnabled(), staleTime: 5 * 60_000 });
  const { data: state } = useServiceState("courier");
  const { data: saved = [] } = useQuery({ queryKey: ["parcel-addresses"], queryFn: fetchParcelAddresses, staleTime: 60_000 });
  const opensAt = state && !state.open ? formatNextOpen(state.next_open_at ?? state.resume_at) : null;

  const guard = () => {
    if (!enabled) {
      toast(c.comingSoon);
      return false;
    }
    if (state && !state.can_order) {
      toast(fill(c.closedNow, { t: opensAt ?? "" }));
      return false;
    }
    if (!hasCoords(pickup)) {
      onChangePickup();
      return false;
    }
    return true;
  };

  const startWithDrop = (drop: ParcelAddr) => {
    if (!guard()) return;
    const d = emptyDraft(pickup);
    d.stops[1].addr = drop;
    writeDraft(d);
    onStart();
  };
  const startMulti = () => {
    if (!guard()) return;
    const d = emptyDraft(pickup);
    d.mode = "multiDrop";
    writeDraft(d);
    onStart();
  };

  const chips: ParcelAddr[] = [
    ...saved.filter((a) => hasCoords(a) && a.id !== pickup?.id).slice(0, 4),
    ...recent.filter((r) => !saved.some((s) => s.id === r.id)),
  ];

  return (
    <div className="-mx-5">
      {opensAt && (
        <p className="flex items-center justify-center gap-1.5 bg-muted py-1.5 text-xs font-bold text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> {fill(c.opens, { t: opensAt })}
        </p>
      )}
      <ParcelMap
        pins={hasCoords(pickup) ? [{ lat: pickup.latitude, lng: pickup.longitude, kind: "pickup" }] : []}
        showMyLocation
        className="h-[48vh] min-h-[260px]"
      />
      <section className="relative -mt-5 rounded-t-[24px] bg-card px-5 pb-4 pt-5 shadow-card-m">
        <button type="button" onClick={onChangePickup} className="flex w-full items-center gap-3 text-left">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
            {pickup ? `${c.pickup}: ${addrTitle(pickup)}` : c.addPickup}
          </span>
          <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={() => guard() && setDropOpen(true)}
          className="mt-4 flex w-full items-center gap-3 rounded-[16px] border border-border bg-surface-soft px-4 py-4 text-left"
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" />
          <span className="flex-1 text-base font-extrabold text-foreground">{c.whereTo}</span>
          <Search className="h-5 w-5 text-muted-foreground" />
        </button>
        {chips.length > 0 && (
          <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
            {chips.map((a) => (
              <button
                key={a.id + a.full_address}
                type="button"
                onClick={() => startWithDrop(a)}
                className="max-w-[180px] shrink-0 truncate rounded-full border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground"
              >
                {a.label || a.area || a.full_address}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={startMulti} className="mt-4 text-sm font-extrabold text-primary">
          {c.sendMany}
        </button>
      </section>
      <LocationPickerSheet
        open={dropOpen}
        activeId={null}
        onClose={() => setDropOpen(false)}
        onSelect={(a) => {
          setDropOpen(false);
          if (!hasCoords(a)) return;
          startWithDrop(a);
        }}
      />
    </div>
  );
}
