import { supabase } from "@/integrations/supabase/client";

/** Current customer coin balance (1 coin = Rs 1 off a booking). */
export async function fetchMyCoinBalance(): Promise<number> {
  const { data, error } = await supabase.rpc("my_coin_balance");
  if (error) {
    console.error("my_coin_balance failed", error);
    return 0;
  }
  const n = Number(data);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Give back coins held for a payment that was cancelled or failed. */
export async function releaseMyCoins(orderId: string | null): Promise<void> {
  if (!orderId) return;
  const { error } = await supabase.rpc("release_my_coin_redemption", {
    _order_id: orderId,
  });
  if (error) console.error("release_my_coin_redemption failed", error);
}

/** Give back a coupon held for a payment that was cancelled or failed. */
export async function releaseMyCoupon(orderId: string | null): Promise<void> {
  if (!orderId) return;
  const { error } = await supabase.rpc("release_my_coupon_redemption", {
    _order_id: orderId,
  });
  if (error) console.error("release_my_coupon_redemption failed", error);
}
