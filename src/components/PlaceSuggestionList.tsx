import { Loader2, MapPin } from "lucide-react";
import type { AddressSuggestion } from "@/lib/addressSearch";
import { useT } from "@/i18n";

function km(d: number | null): string | null {
  if (d == null) return null;
  if (d < 1) return `${Math.round(d * 1000)} m`;
  return `${d.toFixed(1)} km`;
}

/**
 * Rapido-style result list: bold place name, muted area line and the
 * straight-line distance from the customer on the right.
 */
export function PlaceSuggestionList({
  suggestions,
  searching,
  message,
  onPick,
  busyId,
}: {
  suggestions: AddressSuggestion[];
  searching: boolean;
  message: string | null;
  onPick: (s: AddressSuggestion) => void;
  busyId?: string | null;
}) {
  const t = useT();

  if (searching && suggestions.length === 0) {
    return (
      <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("search.searching")}
      </p>
    );
  }
  if (suggestions.length === 0) {
    return message ? (
      <p className="px-3 py-3 text-xs text-muted-foreground">{message}</p>
    ) : null;
  }

  return (
    <ul className="divide-y divide-border/60">
      {suggestions.map((s) => {
        const dist = km(s.distanceKm);
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s)}
              disabled={busyId != null}
              className="flex w-full items-start gap-3 px-3 py-3 text-left transition active:bg-muted disabled:opacity-60"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                {busyId === s.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <MapPin className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-foreground">{s.title}</div>
                {s.area && (
                  <div className="line-clamp-2 text-xs text-muted-foreground">{s.area}</div>
                )}
              </div>
              {dist && (
                <span className="mt-0.5 shrink-0 text-xs font-semibold text-muted-foreground">
                  {dist}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
