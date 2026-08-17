import { supabase } from "@/integrations/supabase/client";

export type AvailabilityTarget = "category" | "item";

export type AvailabilityOverride = {
  target_type: string;
  target_id: string;
  is_unavailable: boolean;
  unavailable_from: string | null;
  unavailable_until: string | null;
  reason: string | null;
};

/** id -> reason (null when no specific reason was set) for currently-blocked targets. */
export type AvailabilityMap = {
  category: Map<string, string | null>;
  item: Map<string, string | null>;
};

export const emptyAvailability: AvailabilityMap = {
  category: new Map(),
  item: new Map(),
};

function isActiveNow(row: AvailabilityOverride, now: number): boolean {
  if (!row.is_unavailable) return false;
  const from = row.unavailable_from ? Date.parse(row.unavailable_from) : null;
  const until = row.unavailable_until ? Date.parse(row.unavailable_until) : null;
  if (from != null && Number.isFinite(from) && now < from) return false;
  if (until != null && Number.isFinite(until) && now > until) return false;
  return true;
}

/**
 * Reads the Command Center availability overrides and reduces them to the set
 * of categories/items that are blocked *right now*. Evaluated on every fetch,
 * so scheduled windows flip over on the next refetch without a rebuild.
 */
export async function fetchAvailability(): Promise<AvailabilityMap> {
  const { data, error } = await supabase
    .from("availability_overrides")
    .select("target_type, target_id, is_unavailable, unavailable_from, unavailable_until, reason");
  if (error) throw error;

  const now = Date.now();
  const map: AvailabilityMap = { category: new Map(), item: new Map() };
  for (const row of (data ?? []) as AvailabilityOverride[]) {
    if (!isActiveNow(row, now)) continue;
    const bucket = row.target_type === "category" ? map.category : row.target_type === "item" ? map.item : null;
    if (!bucket) continue;
    bucket.set(row.target_id, row.reason ?? null);
  }
  return map;
}

export function isUnavailable(
  availability: AvailabilityMap | undefined,
  type: AvailabilityTarget,
  id: string | null | undefined,
): boolean {
  if (!availability || !id) return false;
  return availability[type].has(id);
}

export function unavailableReason(
  availability: AvailabilityMap | undefined,
  type: AvailabilityTarget,
  id: string | null | undefined,
): string | null {
  if (!availability || !id) return null;
  return availability[type].get(id) ?? null;
}
