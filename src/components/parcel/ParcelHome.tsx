// Parcel tab home (inside the app shell): map, pickup card, "Where to send?",
// saved/recent chips and the multi-stop link. Booking steps open full-screen.
// Service hours only show a notice here; the closed check happens at payment.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import type { SavedAddress } from "@/components/LocationPickerSheet";
import { formatNextOpen, useServiceState } from "@/lib/serviceHours";
import { fetchCourierEnabled } from "@/components/courier/courierData";
import { ParcelMap } from "./ParcelMap";
import { ParcelPlacePicker, type PickedPlace } from "./ParcelPlacePicker";
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
  pickup: defaultPickup,
  onStart,
}: {
  pickup: SavedAddress | null;
  onChangePickup?: () => void;
  onStart: () => void;
}) {
  const c = useParcelCopy();
  const [picker, setPicker] = useState<"pickup" | "drop" | null>(null);
  const [pick, setPick] = useState<PickedPlace | null>(null);
  const [recent, setRecent] = useState<ParcelAddr[]>([]);
  useEffect(() => setRecent(readRecentDrops()), []);
  const { data: enabled = true } = useQuery({ queryKey: ["courier_enabled"], queryFn: () => fetchCourierEnabled(), staleTime: 5 * 60_000 });
  const { data: state } = useServiceState("courier");
  const { data: saved = [] } = useQuery({ queryKey: ["parcel-addresses"], queryFn: fetchParcelAddresses, staleTime: 60_000 });
  const opensAt = state && !state.open ? formatNextOpen(state.next_open_at ?? state.resume_at) : null;
  const pickupAddr: ParcelAddr | null = pick?.addr ?? (hasCoords(defaultPickup) ? defaultPickup : null);

  const guard = () => {
    if (!enabled) {
      toast(c.comingSoon);
      return false;
    }
    return true;
  };

  const start = (drop: PickedPlace | null, mode: "single" | "multiDrop") => {
    const d = emptyDraft(pickupAddr);
    d.mode = mode;
    if (pick) {
      d.stops[0].name = pick.name;
      d.stops[0].phone = pick.phone;
    }
    if (drop) {
      d.stops[1].addr = drop.addr;
      d.stops[1].name = drop.name;
      d.stops[1].phone = drop.phone;
    }
    writeDraft(d);
    onStart();
  };

  const openDrop = () => {
    if (!guard()) return;
    if (!pickupAddr) return setPicker("pickup");
    setPicker("drop");
  };

  const chips: ParcelAddr[] = [
    ...saved.filter((a) => hasCoords(a) && a.id !== pickupAddr?.id).slice(0, 4),
    ...recent.filter((r) => !saved.some((s) => s.id === r.id)),
  ];

  return (
    <div className="-mx-5">
      {opensAt && (
        <p className="flex items-center justify-center gap-1.5 bg-muted py-1.5 text-xs font-bold text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> {fill(c.opens, { t: opensAt })}
        </p>
      )}
      <div role="button" tabIndex={0} onClick={() => guard() && setPicker(pickupAddr ? "drop" : "pickup")}>
      <ParcelMap
        pins={pickupAddr ? [{ lat: Number(pickupAddr.latitude), lng: Number(pickupAddr.longitude), kind: "pickup" }] : []}
        showMyLocation
        className="h-[48vh] min-h-[260px]"
      />
      </div>
      <section className="relative -mt-5 rounded-t-[24px] bg-card px-5 pb-4 pt-5 shadow-card-m">
        <div className="relative space-y-2.5">
          <span className="absolute left-[21px] top-[30px] bottom-[30px] w-px border-l-2 border-dashed border-border" />
          <button
            type="button"
            onClick={() => guard() && setPicker("pickup")}
            className="relative flex w-full items-center gap-3 rounded-[16px] border border-border bg-surface-soft px-4 py-4 text-left"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary ring-4 ring-primary/20" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.pickup}</span>
              <span className="block truncate text-base font-extrabold text-foreground">
                {pickupAddr ? addrTitle(pickupAddr) : c.wherePickup}
              </span>
            </span>
            <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={openDrop}
            className="relative flex w-full items-center gap-3 rounded-[16px] border border-border bg-surface-soft px-4 py-4 text-left"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive ring-4 ring-destructive/20" />
            <span className="flex-1 text-base font-extrabold text-foreground">{c.whereTo}</span>
            <Search className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
        {chips.length > 0 && (
          <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
            {chips.map((a) => (
              <button
                key={a.id + a.full_address}
                type="button"
                onClick={openDrop}
                className="max-w-[180px] shrink-0 truncate rounded-full border border-border bg-card px-3.5 py-2 text-xs font-bold text-foreground"
              >
                {a.label || a.area || a.full_address}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => guard() && pickupAddr && start(null, "multiDrop")} className="mt-4 text-sm font-extrabold text-primary">
          {c.sendMany}
        </button>
      </section>
      {picker && (
        <ParcelPlacePicker
          kind={picker}
          startOnMap
          other={picker === "drop" ? pickupAddr : null}
          initial={picker === "pickup" ? pick ?? (pickupAddr ? { addr: pickupAddr, name: "", phone: "" } : null) : null}
          onClose={() => setPicker(null)}
          onAddStops={() => {
            setPicker(null);
            start(null, "multiDrop");
          }}
          onDone={(p) => {
            if (picker === "pickup") {
              setPick(p);
              setPicker("drop");
            } else {
              setPicker(null);
              start(p, "single");
            }
          }}
        />
      )}
    </div>
  );
}
