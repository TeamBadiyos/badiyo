import { supabase } from "@/integrations/supabase/client";

export type AppliedCoupon = {
  code: string;
  couponId: string;
  title: string;
  discount: number;
};

export type MyCoupon = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  max_discount: number | null;
  min_order_amount: number;
  valid_until: string | null;
  source: string;
  is_personal: boolean;
};

export type CouponPreview =
  | { ok: true; coupon: AppliedCoupon }
  | { ok: false; message: string };

function reasonMessage(reason: string, extra?: Record<string, unknown>): string {
  switch (reason) {
    case "invalid_code":
      return "That coupon code isn't valid";
    case "expired":
      return "This coupon has expired";
    case "min_order":
      return `Minimum order of ₹${Number(extra?.min_order_amount ?? 0)} required`;
    case "exhausted":
      return "This coupon has been fully claimed";
    case "already_used":
      return "You've already used this coupon";
    case "not_eligible":
      return "This coupon isn't available on your account";
    case "not_applicable":
      return "This coupon doesn't apply to this service";
    case "no_discount":
      return "This coupon gives no discount on this booking";
    case "not_authenticated":
      return "Please sign in first";
    default:
      return "Couldn't apply this coupon";
  }
}

/** Ask the server what discount a code gives on this booking. Never trusted for payment. */
export async function previewCoupon(
  code: string,
  baseAmount: number,
  durationMinutes?: number | null,
): Promise<CouponPreview> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { ok: false, message: reasonMessage("invalid_code") };

  const { data, error } = await supabase.rpc("coupon_preview", {
    _code: trimmed,
    _base_amount: baseAmount,
    ...(durationMinutes ? { _duration_minutes: durationMinutes } : {}),
  });
  if (error) {
    console.error("coupon_preview failed:", error);
    return { ok: false, message: "Couldn't check this coupon. Please try again." };
  }
  const res = (data ?? {}) as Record<string, unknown>;
  if (res.ok === true) {
    return {
      ok: true,
      coupon: {
        code: String(res.code ?? trimmed),
        couponId: String(res.coupon_id ?? ""),
        title: String(res.title ?? "Coupon"),
        discount: Number(res.discount ?? 0),
      },
    };
  }
  return { ok: false, message: reasonMessage(String(res.reason ?? ""), res) };
}

export async function fetchMyCoupons(): Promise<MyCoupon[]> {
  const { data, error } = await supabase.rpc("my_coupons");
  if (error) {
    console.error("my_coupons failed:", error);
    return [];
  }
  return (data ?? []) as MyCoupon[];
}

export type CampaignOffer = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  deep_link: string | null;
};

export async function fetchCampaignOffers(): Promise<CampaignOffer[]> {
  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("id, title, body, image_url, deep_link")
    .order("starts_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("campaigns fetch failed:", error);
    return [];
  }
  return (data ?? []) as CampaignOffer[];
}

export type ReferralProgress = { invited: number; joined: number; qualified: number };

export async function fetchReferralProgress(): Promise<ReferralProgress> {
  const { data, error } = await supabase.rpc("my_referral_progress");
  if (error) {
    console.error("my_referral_progress failed:", error);
    return { invited: 0, joined: 0, qualified: 0 };
  }
  const r = (data ?? {}) as Record<string, number>;
  return {
    invited: Number(r.invited ?? 0),
    joined: Number(r.joined ?? 0),
    qualified: Number(r.qualified ?? 0),
  };
}

export function couponValueLabel(c: MyCoupon): string {
  if (c.discount_type === "percent") {
    return `${Number(c.discount_value)}% OFF`;
  }
  if (c.discount_type === "free_minutes") {
    const mins = Number(c.discount_value);
    return mins >= 60 ? `${Math.round(mins / 60)} HR FREE` : `${mins} MIN FREE`;
  }
  return `₹${Number(c.discount_value)} OFF`;
}
