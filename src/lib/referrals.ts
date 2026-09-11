import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "badiyo.referralCode";

/** Extract a referral code from the current URL, either ?ref=CODE or /invite/CODE. */
export function readReferralCodeFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("ref") || url.searchParams.get("code");
    if (q && q.trim()) return q.trim().toUpperCase();
    const m = url.pathname.match(/\/invite\/([^/?#]+)/i);
    if (m?.[1]) return decodeURIComponent(m[1]).trim().toUpperCase();
  } catch {
    /* ignore */
  }
  return null;
}

/** Capture the URL's referral code into localStorage so it survives sign-in redirects. */
export function captureReferralCode(): string | null {
  const code = readReferralCodeFromUrl();
  if (!code) return getStoredReferralCode();
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
  return code;
}

export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearStoredReferralCode() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Link the currently signed-in user to a referrer by their code.
 * Idempotent and safe: server function ignores repeat calls & self-referrals.
 */
export async function linkReferralIfAny(): Promise<void> {
  const code = getStoredReferralCode();
  if (!code) return;
  const { error } = await supabase.rpc("link_referral", { _code: code });
  if (error) {
    console.error("link_referral failed:", error);
    return;
  }
  // Keep code in storage until it's actually linked on server? We clear on success
  // so we don't re-attempt on every login; server enforces one-time semantics anyway.
  clearStoredReferralCode();
}

export type ApplyReferralResult =
  | "applied"
  | "invalid_code"
  | "self_referral"
  | "already_referred"
  | "not_authenticated"
  | "error";

/**
 * Apply an invite code entered manually (or prefilled from an invite link) and
 * report the outcome so the UI can show a precise message.
 */
export async function applyReferralCode(rawCode: string): Promise<ApplyReferralResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return "invalid_code";
  const { data, error } = await supabase.rpc("apply_referral_code", { _code: code });
  if (error) {
    console.error("apply_referral_code failed:", error);
    return "error";
  }
  const result = (data as ApplyReferralResult | null) ?? "error";
  if (result === "applied" || result === "already_referred") clearStoredReferralCode();
  return result;
}

export function referralResultMessage(result: ApplyReferralResult): string {
  switch (result) {
    case "applied":
      return "Invite code applied!";
    case "invalid_code":
      return "That invite code doesn't exist";
    case "self_referral":
      return "You can't use your own code";
    case "already_referred":
      return "An invite code is already applied to your account";
    case "not_authenticated":
      return "Please sign in first";
    default:
      return "Couldn't apply the code. Please try again.";
  }
}

/**
 * Called after a booking has been created with status='confirmed'.
 * Server decides if it's the user's first confirmed booking and credits the referrer.
 */
export async function creditReferralForBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc("credit_referral_for_booking", {
    _booking_id: bookingId,
  });
  if (error) {
    console.error("credit_referral_for_booking failed:", error);
  }
}
