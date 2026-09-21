// App-owned push sender (FCM HTTP v1).
//
// The database (notify_push_event / notify_customer_alert / expert alerts)
// posts here with the shared push_trigger_secret. Replaces the old opaque
// Supabase edge function so delivery failures are visible in our own logs.
import { createFileRoute } from "@tanstack/react-router";

type SendBody = {
  user_type?: string;
  user_id?: string;
  alert_type?: string | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown> | null;
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
};

function b64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );
  const jwt = `${header}.${claim}.${b64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token exchange failed [${res.status}]: ${text}`);
  return (JSON.parse(text) as { access_token: string }).access_token;
}

function stringifyData(
  data: Record<string, unknown> | null | undefined,
  alertType: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  if (alertType) out.alert_type = alertType;
  return out;
}

export const Route = createFileRoute("/api/public/push/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-internal-secret") ?? "";
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: cfg } = await supabaseAdmin
          .from("edge_runtime_config" as never)
          .select("value")
          .eq("key", "push_trigger_secret")
          .maybeSingle();
        const expected = (cfg as { value?: string } | null)?.value ?? "";
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        let payload: SendBody;
        try {
          payload = (await request.json()) as SendBody;
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        const userId = payload.user_id;
        const userType = payload.user_type ?? "customer";
        const title = payload.title ?? "";
        const bodyText = payload.body ?? "";
        if (!userId || !title) return new Response("Missing/invalid fields", { status: 400 });

        const raw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
        if (!raw) {
          console.error("[push] FIREBASE_SERVICE_ACCOUNT_JSON not configured");
          return new Response("Not configured", { status: 500 });
        }
        let sa: ServiceAccount;
        try {
          sa = JSON.parse(raw) as ServiceAccount;
        } catch {
          console.error("[push] service account JSON is not valid JSON");
          return new Response("Not configured", { status: 500 });
        }
        if (!sa.client_email || !sa.private_key || !sa.project_id) {
          console.error("[push] service account JSON missing required fields");
          return new Response("Not configured", { status: 500 });
        }

        const { data: tokenRows, error: tokenError } = await supabaseAdmin
          .from("device_tokens" as never)
          .select("id, fcm_token, platform")
          .eq("user_id", userId)
          .eq("user_type", userType);
        if (tokenError) {
          console.error("[push] token lookup failed", tokenError);
          return new Response("token-lookup-failed", { status: 500 });
        }
        const tokens = (tokenRows ?? []) as Array<{
          id: string;
          fcm_token: string;
          platform: string | null;
        }>;
        if (tokens.length === 0) return Response.json({ sent: 0, failed: 0, tokens: 0 });

        let accessToken: string;
        try {
          accessToken = await getAccessToken(sa);
        } catch (err) {
          console.error("[push] google auth failed", err);
          return Response.json(
            { sent: 0, failed: tokens.length, error: String((err as Error)?.message ?? err) },
            { status: 502 },
          );
        }

        const dataPayload = stringifyData(payload.data, payload.alert_type);
        const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

        let sent = 0;
        let failed = 0;
        const stale: string[] = [];

        for (const row of tokens) {
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                authorization: `Bearer ${accessToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                message: {
                  token: row.fcm_token,
                  notification: { title, body: bodyText },
                  data: dataPayload,
                  android: {
                    priority: "HIGH",
                    notification: { channel_id: "customer_alerts", sound: "default" },
                  },
                  apns: {
                    payload: { aps: { sound: "default", "content-available": 1 } },
                  },
                },
              }),
            });
            if (res.ok) {
              sent++;
              continue;
            }
            failed++;
            const errText = await res.text();
            console.error(`[push] send failed [${res.status}]: ${errText}`);
            if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(errText)) {
              stale.push(row.id);
            }
          } catch (err) {
            failed++;
            console.error("[push] send threw", err);
          }
        }

        if (stale.length > 0) {
          await supabaseAdmin
            .from("device_tokens" as never)
            .delete()
            .in("id", stale)
            .then(() => undefined, () => undefined);
        }

        return Response.json({ sent, failed, tokens: tokens.length, removed: stale.length });
      },
    },
  },
});
