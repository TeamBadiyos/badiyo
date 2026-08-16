import { supabase } from "@/integrations/supabase/client";

/**
 * Ensures a row exists in public.users for the currently authenticated user.
 * Safe to call multiple times; upserts on id conflict.
 * Pulls email / full_name from the auth user's metadata when available
 * (e.g. Google OAuth) so the profile is pre-filled.
 * Returns the auth user id, or null if there is no session.
 */
export async function ensureUserRow(phone?: string | null): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    null;
  const email = user.email ?? (meta.email as string | undefined) ?? null;

  const payload: {
    id: string;
    phone?: string;
    email?: string;
    full_name?: string;
  } = { id: user.id };
  if (phone) payload.phone = phone;
  if (email) payload.email = email;
  if (fullName) payload.full_name = fullName;

  const { error } = await supabase
    .from("users")
    .upsert(payload, { onConflict: "id", ignoreDuplicates: false });
  if (error) {
    // users.phone is now uniquely indexed. If another profile already owns this
    // number, never fail the login — write the profile without the phone rather
    // than creating/patching a second row for the same number.
    if (error.code === "23505" && payload.phone) {
      const { phone: _dropped, ...rest } = payload;
      const { error: retryErr } = await supabase
        .from("users")
        .upsert(rest, { onConflict: "id", ignoreDuplicates: false });
      if (!retryErr) return user.id;
      console.error("ensureUserRow retry failed:", retryErr);
      throw retryErr;
    }
    console.error("ensureUserRow failed:", error);
    throw error;
  }
  return user.id;
}
