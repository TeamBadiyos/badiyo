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
  travelFee = 0,
): BillBreakdown & { travelFee: number; travelGst: number } {
  const safeBase = Math.max(Number(base) || 0, 0);
  const disc = Math.min(Math.max(Number(discount) || 0, 0), safeBase);
  const taxable = Math.round((safeBase - disc) * 100) / 100;
  const tf = Math.max(Number(travelFee) || 0, 0);
  // Same as the server: travel fee GST is rounded on its own; GST line includes it.
  const travelGst = Math.round(tf * percent) / 100;
  const exact = taxable + (taxable * percent) / 100 + tf + travelGst;
  const total = Math.round(exact);
  const gst = Math.round((gstAmount(taxable, percent) + travelGst) * 100) / 100;
  const subtotal = Math.round((taxable + tf + gst) * 100) / 100;
  return {
    base: safeBase,
    discount: disc,
    taxable,
    gst,
    subtotal,
    roundOff: Math.round((total - subtotal) * 100) / 100,
    total,
    travelFee: tf,
    travelGst,
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
