import { supabase } from "@/integrations/supabase/client";

const DEVICE_KEY = "badiyos_device_key";

/** Stable per-install key. Never cleared on logout. */
export function getDeviceKey(): string {
  try {
    let k = localStorage.getItem(DEVICE_KEY);
    if (!k) {
      k =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, k);
    }
    return k;
  } catch {
    return "no-storage";
  }
}

// Column-safe list (staff_pin_hash is not readable by customers).
const OFFER_COLS =
  "id,title,description,rules_text,button_text,success_title,success_message,emoji,image_url,card_color,price,mrp,starts_at,ends_at,is_active,per_user_limit,per_device_limit,total_stock,show_remaining,audience,new_users_since,city_ids,undo_seconds,require_staff_pin,payment_hold_minutes,unredeemed_refund_policy,show_as_home_banner,sort_order";

export type EventOffer = {
  id: string;
  title: string;
  description: string | null;
  rules_text: string | null;
  button_text: string | null;
  success_title: string | null;
  success_message: string | null;
  emoji: string | null;
  image_url: string | null;
  price: number;
  mrp: number | null;
  starts_at: string | null;
  ends_at: string | null;
  undo_seconds: number | null;
  require_staff_pin: boolean;
  show_as_home_banner: boolean;
  sort_order: number | null;
};

export type MyRedemption = {
  id: string;
  offer_id: string;
  status: string;
  redeemed_at: string | null;
  undo_deadline: string | null;
  paid_at: string | null;
  created_at: string;
};

export async function fetchLiveOffers(): Promise<EventOffer[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await (supabase as any)
    .from("event_offers")
    .select(OFFER_COLS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as EventOffer[]).filter(
    (o) => (!o.starts_at || o.starts_at <= nowIso) && (!o.ends_at || o.ends_at > nowIso),
  );
}

export async function fetchMyRedemptions(): Promise<MyRedemption[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return [];
  const { data, error } = await (supabase as any)
    .from("event_redemptions")
    .select("id,offer_id,status,redeemed_at,undo_deadline,paid_at,created_at")
    .eq("user_id", u.user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MyRedemption[];
}

export type RedeemResult =
  | { ok: true; id: string; status: string; redeemed_at: string; undo_deadline: string | null }
  | { ok: false; error: string };

export async function redeemOffer(offerId: string, pin?: string): Promise<RedeemResult> {
  const { data, error } = await (supabase as any).rpc("redeem_event_offer", {
    p_offer_id: offerId,
    p_device_key: getDeviceKey(),
    p_staff_pin: pin ?? null,
  });
  if (error) throw error;
  return data as RedeemResult;
}

export async function undoRedemption(id: string): Promise<{ ok: boolean; error?: string; status?: string }> {
  const { data, error } = await (supabase as any).rpc("undo_event_redemption", { p_redemption_id: id });
  if (error) throw error;
  return data;
}

const API = "https://badiyos.com/api/public/offers";

/** kind: "server" = 500/non-JSON/network; "code" = {ok:false,error}. */
export class OfferApiError extends Error {
  kind: "server" | "code";
  code?: string;
  constructor(kind: "server" | "code", code?: string) {
    super(code || kind);
    this.kind = kind;
    this.code = code;
  }
}

async function authed(path: string, body: unknown): Promise<any> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new OfferApiError("code", "NOT_AUTHENTICATED");
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OfferApiError("server");
  }
  let json: any;
  try { json = await res.json(); } catch { throw new OfferApiError("server"); }
  if (json && json.ok === false && typeof json.error === "string") throw new OfferApiError("code", json.error);
  if (!res.ok || !json || json.ok !== true) throw new OfferApiError("server");
  return json;
}

export type CreatePaymentResult =
  | { alreadyPaid: true; id: string }
  | { alreadyPaid: false; redemptionId: string; razorpayOrderId: string; amountPaise: number; currency: string; keyId: string };

export async function createOfferPayment(offerId: string): Promise<CreatePaymentResult> {
  const j = await authed("create-payment", { offer_id: offerId, device_key: getDeviceKey() });
  if (j.already_paid === true) return { alreadyPaid: true, id: j.id };
  return {
    alreadyPaid: false,
    redemptionId: j.redemption_id,
    razorpayOrderId: j.razorpay_order_id,
    amountPaise: j.amount, // already paise — never multiply
    currency: j.currency,
    keyId: j.key_id,
  };
}

export async function verifyOfferPayment(r: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: true; id: string; status: string; duplicate?: boolean }> {
  return authed("verify-payment", {
    razorpay_order_id: r.razorpay_order_id,
    razorpay_payment_id: r.razorpay_payment_id,
    razorpay_signature: r.razorpay_signature,
  });
}

export async function fetchOfferRemaining(offerId: string): Promise<number | null> {
  const { data, error } = await (supabase as any).rpc("get_offer_remaining", { p_offer_id: offerId });
  if (error) return null;
  return typeof data === "number" ? data : null;
}
