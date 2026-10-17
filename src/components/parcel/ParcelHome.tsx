// Parcel tab home (inside the app shell): map, pickup card, "Where to send?",
// saved/recent chips and the multi-stop link. Tapping a box writes the draft
// and opens the full-screen step flow (Pickup → Drop → Vehicle → Checkout).
// Service hours only show a notice here; the closed check happens at payment.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import type { SavedAddress } from "@/components/LocationPickerSheet";
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
  pickup: defaultPickup,
  onStart,
}: {
  pickup: SavedAddress | null;
  onChangePickup?: () => void;
  onStart: () => void;
}) {
  const c = useParcelCopy();
  const [recent, setRecent] = useState<ParcelAddr[]>([]);
  useEffect(() => setRecent(readRecentDrops()), []);
  const { data: enabled = true } = useQuery({ queryKey: ["courier_enabled"], queryFn: () => fetchCourierEnabled(), staleTime: 5 * 60_000 });
  const { data: state } = useServiceState("courier");
  const { data: saved = [] } = useQuery({ queryKey: ["parcel-addresses"], queryFn: fetchParcelAddresses, staleTime: 60_000 });
  const opensAt = state && !state.open ? formatNextOpen(state.next_open_at ?? state.resume_at) : null;
  const pickupAddr: ParcelAddr | null = hasCoords(defaultPickup) ? defaultPickup : null;

  const guard = () => {
    if (!enabled) {
      toast(c.comingSoon);
      return false;
    }
    return true;
  };

  const start = (drop: ParcelAddr | null, mode: "single" | "multiDrop") => {
    const d = emptyDraft(pickupAddr);
    d.mode = mode;
    if (drop && mode === "single") {
      d.stops[1].addr = drop;
    }
    writeDraft(d);
    onStart();
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
      <div role="button" tabIndex={0} onClick={() => guard() && start(null, "single")}>
        <ParcelMap
          pins={pickupAddr ? [{ lat: Number(pickupAddr.latitude), lng: Number(pickupAddr.longitude), kind: "pickup" }] : []}
          showMyLocation
          className="h-[48vh] min-h-[260px]"
        />
      </div>
      <section className="relative -mt-5 rounded-t-[24px] bg-card px-5 pb-4 pt-5 shadow-card-m">
        <div className="grid grid-cols-2 gap-3">
          {(["pickup", "drop"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => guard() && start(null, "single")}
              className="service-glow flex aspect-square flex-col justify-between rounded-[18px] border border-primary/20 p-4 text-left shadow-soft"
            >
              <span className={`h-3 w-3 rounded-full ${k === "pickup" ? "bg-primary ring-4 ring-primary/20" : "bg-destructive ring-4 ring-destructive/20"}`} />
              <span className="min-w-0">
                <span className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">{k === "pickup" ? c.pickup : c.drop}</span>
                <span className="mt-1 line-clamp-2 block min-h-[2.75rem] text-base font-extrabold leading-[1.375rem] text-foreground">
                  {k === "pickup" ? (pickupAddr ? addrTitle(pickupAddr) : c.wherePickup) : c.whereTo}
                </span>
              </span>
            </button>
          ))}
        </div>
        {false && chips.length > 0 && (
          <div>
            {chips.map((a) => (
              <button key={a.id + a.full_address} type="button" onClick={() => start(a, "single")}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => guard() && start(null, "multiDrop")} className="mt-4 hidden text-sm font-extrabold text-primary">
          {c.sendMany}
        </button>
      </section>
    </div>
  );
}
