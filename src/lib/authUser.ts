import { supabase } from "@/integrations/supabase/client";

/**
 * Drop-in replacement for `supabase.auth.getUser()` in UI code.
 *
 * `getUser()` makes a network round trip to the auth server on every call, so
 * screens that looked up the signed-in user before running their own query paid
 * for two sequential requests — noticeably slow on mobile data, on every screen.
 *
 * `getSession()` reads the session that is already stored on the device, with no
 * request at all. Safety is unchanged: the identity used for reads and writes is
 * still enforced server-side by row-level security, not by this value.
 */
export async function getAuthUser() {
  const { data } = await supabase.auth.getSession();
  return { data: { user: data.session?.user ?? null } };
}

export async function getAuthUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
