import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_GST_PERCENT = 5;

/** Rounds to 2 decimals like the database trigger does. */
export function gstAmount(base: number, percent: number): number {
  return Math.round(base * percent) / 100;
}

export function totalWithGst(base: number, percent: number): number {
  return Math.round((base + gstAmount(base, percent)) * 100) / 100;
}

/** Live GST percentage set by admins (ops settings). Falls back to 5%. */
export function useGstPercent(): number {
  const { data } = useQuery({
    queryKey: ["gst_percent"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_gst_percent");
      if (error) throw error;
      const pct = Number(data);
      return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : DEFAULT_GST_PERCENT;
    },
  });
  return data ?? DEFAULT_GST_PERCENT;
}
