import { getAuthUser } from "@/lib/authUser";
import { supabase } from "@/integrations/supabase/client";

export type ServiceabilityResult = {
  serviceable: boolean;
  zone_id: string | null;
  zone_name: string | null;
};

/**
 * Is this point inside an active zone for the given segment?
 *
 * Uses the `check_serviceability` RPC, which reuses the database's existing
 * `point_in_polygon` helper against `zones.boundary` (filtered by
 * `zones.segment_id`, `status = 'active'`, `deleted_at IS NULL`).
 * Passing `segmentId = null` checks every active zone regardless of segment.
 */
export async function checkServiceability(
  lat: number | null | undefined,
  lng: number | null | undefined,
  segmentId?: string | null,
): Promise<ServiceabilityResult> {
  if (lat == null || lng == null) {
    return { serviceable: false, zone_id: null, zone_name: null };
  }
  const { data, error } = await supabase.rpc("check_serviceability", {
    _lat: lat,
    _lng: lng,
    _segment_id: segmentId ?? undefined,
  });
  if (error) throw error;
  return (data ?? { serviceable: false, zone_id: null, zone_name: null }) as unknown as ServiceabilityResult;
}

/** ~250m box — "the same location" for waitlist de-duplication. */
const DEDUPE_DEG = 0.0025;

export type WaitlistLocation = {
  segmentId: string | null;
  latitude: number;
  longitude: number;
  addressText?: string | null;
  city?: string | null;
};

/** Has this customer already waitlisted (roughly) this location for this segment? */
export async function findExistingWaitlistRequest(loc: WaitlistLocation) {
  const { data: userData } = await getAuthUser();
  const uid = userData.user?.id;
  if (!uid || !loc.segmentId) return null;

  let q = supabase
    .from("waitlist_requests")
    .select("id, created_at, status")
    .eq("user_id", uid)
    .eq("segment_id", loc.segmentId)
    .gte("latitude", loc.latitude - DEDUPE_DEG)
    .lte("latitude", loc.latitude + DEDUPE_DEG)
    .gte("longitude", loc.longitude - DEDUPE_DEG)
    .lte("longitude", loc.longitude + DEDUPE_DEG)
    .limit(1);

  const { data, error } = await q;
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Insert a waitlist row for the signed-in customer (RLS: user_id = auth.uid()). */
export async function joinWaitlist(loc: WaitlistLocation) {
  const { data: userData } = await getAuthUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("Please sign in to join the waitlist.");
  if (!loc.segmentId) throw new Error("We couldn't tell which service you're interested in.");

  // Satisfy the FK on public.users.
  const { error: upsertErr } = await supabase.from("users").upsert({ id: uid }, { onConflict: "id" });
  if (upsertErr) throw upsertErr;

  const { data, error } = await supabase
    .from("waitlist_requests")
    .insert({
      user_id: uid,
      segment_id: loc.segmentId,
      latitude: loc.latitude,
      longitude: loc.longitude,
      address_text: loc.addressText ?? null,
      city: loc.city ?? null,
    })
    .select("id, created_at, status")
    .single();
  if (error) throw error;
  return data;
}
