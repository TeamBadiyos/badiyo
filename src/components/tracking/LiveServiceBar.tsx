import { ChevronRight } from "lucide-react";
import {
  formatClock,
  formatRemaining,
  toneForRemaining,
  TONE_HEX,
  useActiveBooking,
  useNow,
} from "@/lib/liveService";

/**
 * Slim sticky bar shown on every screen while a service is running.
 * Purely additive: it never blocks the screen underneath.
 */
export function LiveServiceBar({
  enabled,
  onOpen,
  /** Height (px) of any bottom chrome (tab bar / sticky CTA) to sit above. */
  bottomOffset = 0,
}: {
  enabled: boolean;
  onOpen: (bookingId: string) => void;
  bottomOffset?: number;
}) {
  const booking = useActiveBooking(enabled);
  const now = useNow(!!booking && enabled);

  if (!enabled || !booking) return null;

  const endMs = booking.service_end_at ? Date.parse(booking.service_end_at) : null;
  if (endMs == null) return null;

  const totalSec = Math.max(1, (booking.service_duration_minutes ?? 0) * 60);
  const remainingSec = Math.max(0, Math.floor((endMs - now) / 1000));
  const tone = toneForRemaining(remainingSec);
  const progress = Math.max(0, Math.min(1, remainingSec / totalSec));

  const size = 40;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center"
      style={{
        paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${bottomOffset}px)`,
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(booking.id)}
        className="pointer-events-auto m-3 flex w-full max-w-md items-center gap-3 rounded-[16px] bg-foreground px-4 py-3 text-left shadow-lg active:scale-[0.99]"
      >
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              stroke="rgba(255,255,255,0.2)"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              stroke={TONE_HEX[tone]}
              strokeDasharray={c}
              strokeDashoffset={c * (1 - progress)}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums text-background">
            {formatRemaining(remainingSec)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-background">
            {remainingSec === 0 ? "Service time is over" : "Service Ending Soon"}
          </div>
          <div className="truncate text-xs text-background/70">
            Ends at {formatClock(endMs)}
          </div>
        </div>
        <span
          className="flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs font-bold text-white"
          style={{ backgroundColor: TONE_HEX[tone] }}
        >
          Extend
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </button>
    </div>
  );
}
