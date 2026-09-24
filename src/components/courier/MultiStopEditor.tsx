// Extra pickups / drops for a multi-stop parcel. Only rendered when the
// selected city + vehicle allows more than one pickup or drop.
import { MapPinned, Pencil, Phone, Plus, Route as RouteIcon, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";

export type StopAddr = {
  id: string;
  label: string | null;
  full_address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean | null;
};

export type ExtraStop = { key: string; addr: StopAddr | null; name: string; phone: string };
export type DropSource = "P1" | "P2" | "both";

export function MultiStopSection({
  kind,
  stops,
  canAdd,
  fee,
  onAdd,
  onRemove,
  onPickAddress,
  onChange,
  showSources,
  sources,
  onSource,
}: {
  kind: "pickup" | "drop";
  stops: ExtraStop[];
  canAdd: boolean;
  fee: number;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onPickAddress: (key: string) => void;
  onChange: (key: string, patch: Partial<ExtraStop>) => void;
  showSources?: boolean;
  sources?: Record<string, DropSource | undefined>;
  onSource?: (key: string, value: DropSource) => void;
}) {
  const t = useT();
  const pickup = kind === "pickup";
  return (
    <div className="space-y-3">
      {stops.map((stop, i) => (
        <div key={stop.key} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-extrabold text-foreground">
              {pickup ? t("courier.pickupN", { n: i + 2 }) : t("courier.dropN", { n: i + 2 })}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(stop.key)} className="text-destructive">
              <Trash2 className="h-4 w-4" /> {t("courier.removeStop")}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onPickAddress(stop.key)}
            className="mt-1 grid h-auto w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 whitespace-normal rounded-lg px-2 py-2 text-left"
          >
            <span className={`grid h-8 w-8 place-items-center rounded-full ${pickup ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>
              {pickup ? <RouteIcon className="h-4 w-4" /> : <MapPinned className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className={`block truncate text-sm font-extrabold ${stop.addr ? "text-foreground" : "text-primary"}`}>
                {stop.addr?.label || (pickup ? t("courier.choosePickup") : t("courier.chooseDrop"))}
              </span>
              {stop.addr && <span className="block line-clamp-1 text-xs text-muted-foreground">{stop.addr.full_address}</span>}
            </span>
            {stop.addr ? <Pencil className="h-4 w-4 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
          </Button>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="relative">
              <UserRound className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input value={stop.name} onChange={(e) => onChange(stop.key, { name: e.target.value })} placeholder={t("courier.contactName")} className="h-12 pl-10" />
            </div>
            <div className="relative">
              <Phone className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                inputMode="numeric"
                value={stop.phone}
                onChange={(e) => onChange(stop.key, { phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                placeholder={t("courier.mobileNumber")}
                className="h-12 pl-10"
              />
            </div>
          </div>
          {showSources && sources && onSource && (
            <SourceChips value={sources[stop.key]} onChange={(v) => onSource(stop.key, v)} />
          )}
        </div>
      ))}
      {canAdd && (
        <Button type="button" variant="outline" onClick={onAdd} className="h-11 w-full border-dashed font-bold text-primary">
          <Plus className="h-4 w-4" />
          {pickup ? t("courier.addPickup") : t("courier.addDrop")}
          {fee > 0 && <span className="text-xs font-semibold text-muted-foreground">(+₹{fee})</span>}
        </Button>
      )}
    </div>
  );
}

export function SourceChips({ value, onChange }: { value?: DropSource; onChange: (v: DropSource) => void }) {
  const t = useT();
  const opts: Array<{ v: DropSource; label: string }> = [
    { v: "P1", label: t("courier.pickupN", { n: 1 }) },
    { v: "P2", label: t("courier.pickupN", { n: 2 }) },
    { v: "both", label: t("courier.bothPickups") },
  ];
  return (
    <div className="mt-3">
      <p className="text-xs font-bold text-muted-foreground">{t("courier.parcelFrom")}</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${value === o.v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PlannedRoute({ items }: { items: Array<{ key: string; type: "pickup" | "drop" }> }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
      {items.map((it, i) => (
        <span key={it.key} className="flex items-center gap-1.5">
          <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${it.type === "pickup" ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"}`}>
            {i + 1}
          </span>
          <span className="text-foreground">
            {it.type === "pickup" ? t("courier.pickup") : t("courier.drop")} {it.key.slice(1)}
          </span>
          {i < items.length - 1 && <span className="text-muted-foreground">·</span>}
        </span>
      ))}
    </div>
  );
}
