// Supabase Edge Function: verify-otp
// Verifies the OTP, creates/updates a Supabase auth user backed by a synthetic
// email (phone provider is disabled), and returns a session.
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
    const { phone, code } = await req.json().catch(() => ({}));
    const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
    const codeStr = String(code ?? "").trim();
    if (digits.length !== 10 || !/^\d{4}$/.test(codeStr)) {
      return json({ error: "Invalid phone or code" }, 400);
    }
    const fullPhone = `+91${digits}`;
    // Synthetic email used as the auth identity since Supabase phone provider
    // is disabled. Kept internal — never shown to the user.
    const syntheticEmail = `phone_91${digits}@badiyos.phone.local`;

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, serviceKey);

    // Find latest matching unverified, unexpired OTP.
    const { data: rows, error: qErr } = await admin
      .from("otp_codes")
      .select("id, code, expires_at, is_verified")
      .eq("phone", fullPhone)
      .eq("is_verified", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (qErr) {
      console.error("otp lookup failed", qErr);
      return json({ error: "Verification failed" }, 500);
    }
    const row = rows?.[0];
    if (!row || row.code !== codeStr) {
      return json({ error: "Invalid or expired code" }, 400);
    }

    // Mark verified (single-use) in parallel with the auth-user lookup.
    const markVerifiedP = admin
      .from("otp_codes")
      .update({ is_verified: true })
      .eq("id", row.id);

    // Look up an existing auth user by synthetic email, by legacy auth phone,
    // and by the customer profile's phone — the first match wins.
    // The profile lookup matters: accounts created under the older anonymous
    // sign-in flow have neither a synthetic email nor auth.users.phone, so
    // without it a repeat login mints a SECOND account for the same number
    // (that is exactly how the duplicate profile was created).
    const [emailRes, phoneRes, profileRes] = await Promise.all([
      admin.rpc("get_auth_user_id_by_email", { _email: syntheticEmail }),
      admin.rpc("get_auth_user_id_by_phone", { _phone: `91${digits}` }),
      admin.rpc("get_customer_auth_id_by_phone", { _phone: fullPhone }),
    ]);
    let userId: string | null =
      (emailRes.data as string | null) ||
      (phoneRes.data as string | null) ||
      (profileRes.data as string | null) ||
      null;


    const password = crypto.randomUUID() + crypto.randomUUID();

    if (userId) {
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
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        password,
        user_metadata: { phone: fullPhone },
      });
      if (createErr || !created.user) {
        console.error("createUser failed", createErr);
        return json({ error: createErr?.message || "Could not create account" }, 500);
      }
      userId = created.user.id;
    }

    // Sign in with the freshly-set password to mint a session.
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

    // Ensure the single-use marker landed before returning.
    await markVerifiedP;

    return json({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });

  } catch (err) {
    console.error("verify-otp error", err);
    return json({ error: (err as Error).message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
