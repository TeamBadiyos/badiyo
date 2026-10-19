import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ZoneInfo = {
  zone_id: string | null;
  zone_type: "core" | "outer" | "not_serviceable" | string;
  travel_fee: number;
  travel_fee_services: string[];
};

/** Server-side zone lookup (Command Center resolve_zone). The app only displays it. */
export async function resolveZone(lat: number, lng: number): Promise<ZoneInfo> {
  const { data, error } = await supabase.rpc("resolve_zone" as never, { _lat: lat, _lng: lng } as never);
  if (error) throw error;
  const d = (data ?? {}) as Partial<ZoneInfo>;
  return {
    zone_id: d.zone_id ?? null,
    zone_type: d.zone_type ?? "not_serviceable",
    travel_fee: Number(d.travel_fee ?? 0) || 0,
    travel_fee_services: Array.isArray(d.travel_fee_services) ? d.travel_fee_services : [],
  };
}

/** Re-resolves whenever the address coordinates change. */
export function useZone(lat: number | null | undefined, lng: number | null | undefined) {
  return useQuery({
    queryKey: ["resolve_zone", lat, lng],
    enabled: lat != null && lng != null,
    staleTime: 60_000,
    queryFn: () => resolveZone(lat as number, lng as number),
  });
}

/** Travel fee shown for a Clean ("clean") or Wash ("auto_care") booking. */
export function travelFeeFor(zone: ZoneInfo | undefined, svc: "clean" | "auto_care"): number {
  if (!zone || zone.zone_type !== "outer") return 0;
  return zone.travel_fee_services.includes(svc) ? zone.travel_fee : 0;
}
