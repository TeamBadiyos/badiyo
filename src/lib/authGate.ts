import { supabase } from "@/integrations/supabase/client";

/** Event the app shell listens to: open the phone OTP login, then come back. */
export const LOGIN_REQUIRED_EVENT = "badiyos:login-required";

/**
 * Guests can browse everything; real actions (Book, Enroll, Apply coupon,
 * Wallet, Orders, Pay) call this first. Returns true when signed in;
 * otherwise opens the login screen and returns false.
 */
export async function ensureSignedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) return true;
  } catch {
    /* treat as guest */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOGIN_REQUIRED_EVENT));
  }
  return false;
}
