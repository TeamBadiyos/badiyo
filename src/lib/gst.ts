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

export type BillBreakdown = {
  base: number;
  discount: number;
  taxable: number;
  gst: number;
  subtotal: number;
  roundOff: number;
  total: number;
};

/**
 * GST is charged on the taxable value left AFTER the discount, and the
 * payable amount is rounded to the nearest whole rupee.
 */
export function billBreakdown(
  base: number,
  percent: number,
  discount = 0,
): BillBreakdown {
  const safeBase = Math.max(Number(base) || 0, 0);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), safeBase);
  const taxable = Math.round((safeBase - disc) * 100) / 100;
  const gst = gstAmount(taxable, percent);
  const subtotal = Math.round((taxable + gst) * 100) / 100;
  const total = Math.round(subtotal);
  return {
    base: safeBase,
    discount: disc,
    taxable,
    gst,
    subtotal,
    roundOff: Math.round((total - subtotal) * 100) / 100,
    total,
  };
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
