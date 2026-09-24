// Unified route timeline for the parcel booking screen.
// Every stop is one self-contained card (address + contact together), linked by
// a vertical route line. A plain 1 pickup + 1 drop booking shows just two cards.
import { MapPinned, Pencil, Phone, Plus, Route as RouteIcon, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";

export type TimelineAddr = {
  id: string;
  label: string | null;
  full_address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean | null;
};

export type TimelineStop = {
  key: string;
  type: "pickup" | "drop";
  index: number;
  addr: TimelineAddr | null;
  name: string;
  phone: string;
  removable: boolean;
};

export function RouteTimeline({
  stops,
  canAddPickup,
  canAddDrop,
  pickupFee,
  dropFee,
  onAddPickup,
  onAddDrop,
  onRemove,
  onPickAddress,
  onChange,
}: {
  stops: TimelineStop[];
  canAddPickup: boolean;
  canAddDrop: boolean;
  pickupFee: number;
  dropFee: number;
  onAddPickup: () => void;
  onAddDrop: () => void;
  onRemove: (key: string) => void;
  onPickAddress: (key: string) => void;
  onChange: (key: string, patch: { name?: string; phone?: string }) => void;
}) {
  const t = useT();
  const lastPickup = [...stops].reverse().find((s) => s.type === "pickup");

  return (
    <div className="relative">
      <div className="absolute bottom-6 left-[19px] top-6 w-px bg-[repeating-linear-gradient(to_bottom,var(--border)_0_6px,transparent_6px_12px)]" />
      <div className="space-y-3">
        {stops.map((stop) => (
          <div key={stop.key}>
            <StopCard
              stop={stop}
              onRemove={() => onRemove(stop.key)}
              onPickAddress={() => onPickAddress(stop.key)}
              onChange={(patch) => onChange(stop.key, patch)}
            />
            {canAddPickup && lastPickup?.key === stop.key && (
              <AddStopButton
                label={t("courier.addPickup")}
                fee={pickupFee}
                onClick={onAddPickup}
                tone="pickup"
              />
            )}
          </div>
        ))}
        {canAddDrop && (
          <AddStopButton label={t("courier.addDrop")} fee={dropFee} onClick={onAddDrop} tone="drop" />
        )}
      </div>
    </div>
  );
}

function StopCard({
  stop,
  onRemove,
  onPickAddress,
  onChange,
}: {
  stop: TimelineStop;
  onRemove: () => void;
  onPickAddress: () => void;
  onChange: (patch: { name?: string; phone?: string }) => void;
}) {
  const t = useT();
  const pickup = stop.type === "pickup";
  const filled = Boolean(stop.addr);
  return (
    <div className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-3">
      <div className="pt-4">
        <span
          className={`relative z-10 grid h-10 w-10 place-items-center rounded-full border-4 border-background text-xs font-extrabold ${
            pickup ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"
          }`}
        >
          {pickup ? <RouteIcon className="h-4 w-4" /> : <MapPinned className="h-4 w-4" />}
        </span>
      </div>
      <div
        className={`animate-fade-slide-in min-w-0 rounded-lg border bg-card shadow-card-m transition-colors ${
          filled ? "border-border" : "border-dashed border-primary/40"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <span
            className={`text-[11px] font-extrabold uppercase tracking-wide ${pickup ? "text-primary" : "text-destructive"}`}
          >
            {pickup ? t("courier.pickupN", { n: stop.index }) : t("courier.dropN", { n: stop.index })}
          </span>
          {stop.removable && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="-mr-2 h-7 px-2 text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> {t("courier.removeStop")}
            </Button>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onPickAddress}
          className="grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 whitespace-normal rounded-none px-4 py-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-xs font-bold text-muted-foreground">
              {pickup ? t("courier.pickupFrom") : t("courier.deliverTo")}
            </span>
            <span className={`mt-0.5 block truncate text-sm font-extrabold ${filled ? "text-foreground" : "text-primary"}`}>
              {stop.addr?.label || (pickup ? t("courier.choosePickup") : t("courier.chooseDrop"))}
            </span>
            {stop.addr && (
              <span className="mt-0.5 block line-clamp-1 text-xs font-normal text-muted-foreground">
                {stop.addr.full_address}
              </span>
            )}
          </span>
          {filled ? <Pencil className="h-4 w-4 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
        </Button>
        <div className="grid gap-2 border-t border-border px-4 py-3 sm:grid-cols-2">
          <div className="relative">
            <UserRound className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={stop.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder={t("courier.contactName")}
              className="h-12 pl-10"
            />
          </div>
          <div className="relative">
            <Phone className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              inputMode="numeric"
              value={stop.phone}
              onChange={(e) => onChange({ phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              placeholder={t("courier.mobileNumber")}
              className="h-12 pl-10"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AddStopButton({
  label,
  fee,
  onClick,
  tone,
}: {
  label: string;
  fee: number;
  onClick: () => void;
  tone: "pickup" | "drop";
}) {
  return (
    <div className="mt-3 grid grid-cols-[40px_minmax(0,1fr)] gap-3">
      <div className="grid place-items-center">
        <span
          className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-4 border-background ${
            tone === "pickup" ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        className="h-11 w-full justify-start border-dashed font-bold text-primary"
      >
        {label}
        {fee > 0 && <span className="text-xs font-semibold text-muted-foreground">(+₹{fee})</span>}
      </Button>
    </div>
  );
}
