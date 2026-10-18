// Supabase Edge Function: send-otp
// Generates a 4-digit code, stores it in otp_codes, and sends via AiSensy WhatsApp.
// Limits: 3 sends per phone per 10 min; per IP 300/hour (2,000/hour in event
// mode window from ops_settings or OTP_EVENT_MODE_START/END secrets); global
// cap 3,000/hour raises a Command Center alert. All editable in ops_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PHONE_LIMIT = 3;
const PHONE_WINDOW_MIN = 10;
const IP_LIMIT = 300;
const EVENT_IP_LIMIT = 2000;
const GLOBAL_CAP = 3000;
const IP_WINDOW_MIN = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone } = await req.json().catch(() => ({}));
    const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) {
      return json({ error: "Valid 10-digit phone required" }, 400);
    }
    const fullPhone = `+91${digits}`;

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate-limit settings (Command Center → ops_settings; secrets as fallback)
    const { data: settingRows } = await supabase
      .from("ops_settings")
      .select("key, value")
      .in("key", [
        "otp_ip_limit_per_hour",
        "otp_event_ip_limit_per_hour",
        "otp_event_mode_start",
        "otp_event_mode_end",
        "otp_global_cap_per_hour",
      ]);
    const s = new Map((settingRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
    const num = (k: string, d: number) => {
      const n = Number(s.get(k));
      return Number.isFinite(n) && n > 0 ? n : d;
    };
    const evStart = Date.parse(s.get("otp_event_mode_start") || Deno.env.get("OTP_EVENT_MODE_START") || "");
    const evEnd = Date.parse(s.get("otp_event_mode_end") || Deno.env.get("OTP_EVENT_MODE_END") || "");
    const eventMode = Number.isFinite(evStart) && Number.isFinite(evEnd) && Date.now() >= evStart && Date.now() <= evEnd;
    const ipLimit = eventMode ? num("otp_event_ip_limit_per_hour", EVENT_IP_LIMIT) : num("otp_ip_limit_per_hour", IP_LIMIT);
    const globalCap = num("otp_global_cap_per_hour", GLOBAL_CAP);

    // Rate-limit checks
    const nowIso = new Date().toISOString();
    const phoneSince = new Date(Date.now() - PHONE_WINDOW_MIN * 60_000).toISOString();
    const ipSince = new Date(Date.now() - IP_WINDOW_MIN * 60_000).toISOString();

    const [{ count: phoneCount }, { count: ipCount }, { count: globalCount }] = await Promise.all([
      supabase
        .from("otp_rate_limits")
        .select("id", { head: true, count: "exact" })
        .eq("phone", fullPhone)
        .gte("created_at", phoneSince),
      supabase
        .from("otp_rate_limits")
        .select("id", { head: true, count: "exact" })
        .eq("ip", ip)
        .gte("created_at", ipSince),
      supabase
        .from("otp_rate_limits")
        .select("id", { head: true, count: "exact" })
        .gte("created_at", ipSince),
    ]);

    if ((globalCount ?? 0) >= globalCap) {
      console.error("send-otp GLOBAL CAP reached", { count: globalCount, cap: globalCap, eventMode });
      const { error: alertErr } = await supabase.rpc("otp_global_cap_alert", { _count: globalCount ?? 0, _cap: globalCap });
      if (alertErr) console.error("otp_global_cap_alert failed", alertErr);
      return json({ error: "We're getting a lot of sign-ins right now. Please try again in a few minutes." }, 429);
    }
    if ((phoneCount ?? 0) >= PHONE_LIMIT || (ipCount ?? 0) >= ipLimit) {
      return json({ error: "Too many attempts, please try again later" }, 429);
    }

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insErr } = await supabase.from("otp_codes").insert({
      phone: fullPhone,
      code,
      expires_at: expiresAt,
      is_verified: false,
    });
    if (insErr) {
      console.error("otp insert failed", insErr);
      return json({ error: "Could not create OTP" }, 500);
    }

    const apiKey = Deno.env.get("AISENSY_API_KEY");
    if (!apiKey) return json({ error: "AISENSY_API_KEY not configured" }, 500);
    const campaignName = Deno.env.get("AISENSY_CAMPAIGN_NAME");
    if (!campaignName) return json({ error: "AISENSY_CAMPAIGN_NAME not configured" }, 500);

    // Run the rate-limit insert in parallel with the AiSensy send; both must
    // complete before we return so failed sends still count against the limit.
    const rateLimitP = supabase
      .from("otp_rate_limits")
      .insert({ phone: fullPhone, ip, created_at: nowIso });

    const aiResP = fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName,
        destination: fullPhone,
        userName: digits,
        templateParams: [code],
        buttons: [
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: code }],
          },
        ],
      }),
    });

    const [, aiRes] = await Promise.all([rateLimitP, aiResP]);

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("AiSensy send failed", aiRes.status, text);
      let detail = text;
      try { detail = JSON.parse(text)?.message ?? text; } catch { /* keep raw */ }
      return json({ error: `AiSensy: ${detail}` }, 502);
    }

    return json({ success: true });

  } catch (err) {
    console.error("send-otp error", err);
    return json({ error: (err as Error).message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
