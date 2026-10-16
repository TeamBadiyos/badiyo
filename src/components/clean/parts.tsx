import { MapPin } from "lucide-react";
import type { SegmentService } from "@/lib/segments";

export function AddressLine({ text, changeLabel, addLabel, onChange }: { text: string | null; changeLabel: string; addLabel: string; onChange: () => void }) {
  return (
    <button onClick={onChange} className="flex w-full items-center gap-2 text-left text-sm">
      <MapPin className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate font-bold text-foreground">{text || addLabel}</span>
      <span className="font-extrabold text-primary">{changeLabel}</span>
    </button>
  );
}

export function DurationCard({
  option, active, full, popularLabel, fullLabel, onClick, className = "",
}: {
  option: SegmentService; active: boolean; full?: boolean; popularLabel: string; fullLabel: string; onClick: () => void; className?: string;
}) {
  const price = Number(option.price);
  const old = Number(option.strikethrough_price);
  const popular = Number(option.duration_minutes) === 120;
  return (
    <button
      disabled={full}
      onClick={onClick}
      className={`relative flex flex-col items-start rounded-[16px] border-2 p-3 pt-4 text-left transition ${
        full ? "border-border bg-muted opacity-60" : active ? "border-primary bg-primary/5" : "border-border bg-card"
      } ${className}`}
    >
      {popular && !full && (
        <span className="absolute -top-2 left-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-extrabold text-primary-foreground">{popularLabel}</span>
      )}
      {full && (
        <span className="absolute -top-2 left-2 rounded-full bg-muted-foreground px-2 py-0.5 text-[10px] font-extrabold text-background">{fullLabel}</span>
      )}
      <span className="text-sm font-bold text-foreground">{option.duration_label}</span>
      <span className="mt-1 text-lg font-extrabold text-foreground">₹{price}</span>
      {old > price && <span className="text-xs text-muted-foreground line-through">₹{old}</span>}
    </button>
  );
}

export function DayCard({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-w-[84px] shrink-0 flex-col items-center rounded-[16px] border-2 px-3 py-3 ${
        active ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <span className="text-sm font-extrabold text-foreground">{label}</span>
      <span className="mt-0.5 text-xs font-semibold text-muted-foreground">{sub}</span>
    </button>
  );
}

/** Green calendar with a "Full" tag — drawn with theme colours. */
export function FullCalendarArt({ fullLabel }: { fullLabel: string }) {
  return (
    <svg viewBox="0 0 120 110" className="mx-auto h-28 w-32" aria-hidden>
      <rect x="10" y="18" width="90" height="80" rx="14" className="fill-primary/10 stroke-primary" strokeWidth="3" />
      <rect x="10" y="18" width="90" height="22" rx="10" className="fill-primary" />
      <rect x="30" y="8" width="6" height="18" rx="3" className="fill-primary" />
      <rect x="74" y="8" width="6" height="18" rx="3" className="fill-primary" />
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => (
          <rect key={`${r}${c}`} x={22 + c * 18} y={50 + r * 14} width="10" height="8" rx="2" className="fill-primary/40" />
        )),
      )}
      <g transform="rotate(-12 88 82)">
        <rect x="62" y="70" width="52" height="22" rx="11" className="fill-destructive" />
        <text x="88" y="86" textAnchor="middle" className="fill-destructive-foreground" fontSize="12" fontWeight="800">{fullLabel}</text>
      </g>
    </svg>
  );
}
