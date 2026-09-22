// Forward address search over plain HTTP.
//
// The Places API (New) is blocked on this project's Google key
// (API_KEY_SERVICE_BLOCKED), but the Geocoding API is active, so address
// search runs through `maps/api/geocode/json?address=...`.
//
// Lives under /api/public/* so the native shell can reach it, but requires a
// valid Supabase session bearer token — never an open Google Maps proxy.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseUrl } from "@/lib/supabaseEndpoint";

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

export const Route = createFileRoute("/api/public/geocode-search")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: CORS }),
      POST: async ({ request }) => {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Unauthorized" }, 401);

        const SUPABASE_URL = resolveSupabaseUrl(process.env['SUPABASE_URL']);
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

        const body = (await request.json().catch(() => ({}))) as {
          query?: string;
          lat?: number;
          lng?: number;
        };
        const query = String(body.query ?? "").trim().slice(0, 120);
        if (query.length < 3) return json({ results: [] });

        const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
        const GOOGLE_MAPS_API_KEY = process.env['GOOGLE_MAPS_API_KEY'];
        if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
          return json({ error: "Missing Google Maps connector credentials" }, 500);
        }

        const params = new URLSearchParams({ address: query, region: "in", components: "country:IN" });
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          // ~40km box around the current pin, so local results win.
          params.set("bounds", `${lat - 0.35},${lng - 0.35}|${lat + 0.35},${lng + 0.35}`);
        }

        const res = await fetch(
          `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
            },
          },
        );
        if (!res.ok) {
          const text = await res.text();
          console.error(`[geocode-search] gateway ${res.status}: ${text}`);
          return json({ error: `Search failed [${res.status}]` }, 502);
        }
        const data = (await res.json()) as {
          status: string;
          error_message?: string;
          results?: Array<{
            formatted_address: string;
            address_components: Array<{ long_name: string; types: string[] }>;
            geometry?: { location?: { lat: number; lng: number } };
          }>;
        };
        if (data.status === "ZERO_RESULTS") return json({ results: [] });
        if (data.status !== "OK" || !data.results?.length) {
          console.error("[geocode-search] google status", data.status, data.error_message);
          return json({ error: `Search failed: ${data.status}` }, 502);
        }

        const results = data.results
          .filter((r) => r.geometry?.location)
          .slice(0, 6)
          .map((r) => {
            const pick = (types: string[]) =>
              r.address_components.find((c) => types.some((t) => c.types.includes(t)))?.long_name ?? null;
            const title =
              pick(["point_of_interest", "premise", "sublocality", "sublocality_level_1", "neighborhood", "route"]) ??
              pick(["locality"]) ??
              r.formatted_address.split(",")[0];
            return {
              title,
              address: r.formatted_address,
              lat: r.geometry!.location!.lat,
              lng: r.geometry!.location!.lng,
              pincode: pick(["postal_code"]),
            };
          });
        return json({ results });
      },
    },
  },
});
