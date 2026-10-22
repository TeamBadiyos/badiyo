// Supabase Edge Function: verify-pin-login
// Verifies a customer's 4-digit login PIN via the SECURITY DEFINER
// verify_login_pin RPC. On success, mints a Supabase auth session for the
// customer using the same synthetic-email + reset-password pattern used by
// verify-otp. Returns 429 with retry_after_seconds when locked out.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, pin, user_type } = await req.json().catch(() => ({}));
    // user_type is optional for backward compatibility with installed apps
    // that never sent it; default to "customer".
    const userType = user_type == null || user_type === "" ? "customer" : String(user_type);
    if (userType !== "customer") {
      return json({ error: "Invalid request" }, 400);
    }
    const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
    const pinStr = String(pin ?? "").trim();
    if (digits.length !== 10 || !/^\d{4}$/.test(pinStr)) {
      return json({ error: "Invalid phone or PIN" }, 400);
    }
    const fullPhone = `+91${digits}`;
    const syntheticEmail = `phone_91${digits}@badiyos.phone.local`;

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, serviceKey);

    const { data: rows, error: rpcErr } = await admin.rpc("verify_login_pin", {
      p_phone: fullPhone,
      p_pin: pinStr,
      p_user_type: userType,
    });
    if (rpcErr) {
      console.error("verify_login_pin failed", rpcErr);
      return json({ error: "PIN verification failed" }, 500);
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return json({ error: "Invalid PIN" }, 401);

    if (row.status === "locked") {
      return json(
        { error: "Too many attempts. Try again later.", retry_after_seconds: row.retry_after_seconds ?? 0 },
        429,
      );
    }
    if (row.status !== "ok" || !row.auth_user_id) {
      return json({ error: "Incorrect PIN" }, 401);
    }

    const userId: string = row.auth_user_id;
    const password = crypto.randomUUID() + crypto.randomUUID();

    // Rotate password + ensure synthetic email so signInWithPassword works.
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      email: syntheticEmail,
      email_confirm: true,
      user_metadata: { phone: fullPhone },
    });
    if (updErr) {
      console.error("updateUserById failed", updErr);
      return json({ error: updErr.message || "Could not sign in" }, 500);
    }

    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
      email: syntheticEmail,
      password,
    });
    if (signErr || !signIn.session) {
      console.error("signInWithPassword failed", signErr);
      return json({ error: signErr?.message || "Could not sign in" }, 500);
    }

    return json({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
  } catch (err) {
    console.error("verify-pin-login error", err);
    return json({ error: (err as Error).message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
