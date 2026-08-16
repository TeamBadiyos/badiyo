// Reverse geocoding over plain HTTP.
//
// The address picker previously depended on the `reverseGeocode` server
// function. In the packaged Capacitor app that call is cross-origin and its
// RPC id must match the deployed build exactly; when it does not, the call
// fails (or never resolves) and the address field never fills in. A raw HTTP
// route has a stable URL and plain JSON, so the native WebView can always
// reach it.
//
// It lives under /api/public/* so the published-site auth wall does not block
// the native shell, but the handler itself requires a valid Supabase session
// bearer token — this must never become an open Google Maps proxy.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/reverse-geocode")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: CORS }),
      POST: async ({ request }) => {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Unauthorized" }, 401);

        const SUPABASE_URL = process.env['SUPABASE_URL'];
        const SUPABASE_PUBLISHABLE_KEY = process.env['SUPABASE_PUBLISHABLE_KEY'];
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return json({ error: "Server not configured" }, 500);
        }
        const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } },
        });
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

        const body = (await request.json().catch(() => ({}))) as { lat?: number; lng?: number };
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          return json({ error: "Invalid coordinates" }, 400);
        }

        const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
        const GOOGLE_MAPS_API_KEY = process.env['GOOGLE_MAPS_API_KEY'];
        if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
          return json({ error: "Missing Google Maps connector credentials" }, 500);
        }

        const res = await fetch(
          `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?latlng=${lat},${lng}`,
          {
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            },
          },
        );
        if (!res.ok) {
          const text = await res.text();
          console.error(`[reverse-geocode] gateway ${res.status}: ${text}`);
          return json({ error: `Geocoding failed [${res.status}]` }, 502);
        }
        const data = (await res.json()) as {
          status: string;
          error_message?: string;
          results?: Array<{
            formatted_address: string;
            address_components: Array<{ long_name: string; types: string[] }>;
          }>;
        };
        if (data.status !== "OK" || !data.results?.length) {
          console.error("[reverse-geocode] google status", data.status, data.error_message);
          return json({ error: `Geocoding failed: ${data.error_message ?? data.status}` }, 502);
        }
        const top = data.results[0];
        const pick = (types: string[]) =>
          top.address_components.find((c) => types.some((t) => c.types.includes(t)))?.long_name ?? null;
        return json({
          formatted_address: top.formatted_address,
          area: pick(["sublocality", "sublocality_level_1", "neighborhood"]) ?? pick(["locality"]),
          city: pick(["locality"]) ?? pick(["administrative_area_level_2"]),
        });
      },
    },
  },
});
