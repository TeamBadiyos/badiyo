// Rapido-style place search (Google Places API New) behind our server.
//
// Two actions on one route:
//   autocomplete -> suggestions with business name, area and distance
//   details      -> coordinates + pincode for the tapped suggestion
//
// Lives under /api/public/* so the native shell can reach it, but a valid
// Supabase session bearer token is required — never an open Google proxy.
// The Google key stays on the server.
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

/** Best-effort per-user rate limit (per worker instance). */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;
function rateLimited(userId: string): boolean {
  const now = Date.now();
  const list = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(userId, list);
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return list.length > MAX_PER_WINDOW;
}

const LATUR = { latitude: 18.4088, longitude: 76.5604 };

type Component = { longText: string; types: string[] };

function pick(components: Component[], types: string[]): string | null {
  return (components ?? []).find((c) => types.some((t) => (Array.isArray(c.types) && c.types.includes(t))))?.longText ?? null;
}

export const Route = createFileRoute("/api/public/places-search")({
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
        if (rateLimited(userData.user.id)) return json({ error: "Too many searches" }, 429);

        const LOVABLE_API_KEY = process.env['LOVABLE_API_KEY'];
        const GOOGLE_MAPS_API_KEY = process.env['GOOGLE_MAPS_API_KEY'];
        if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
          return json({ error: "Missing Google Maps connector credentials" }, 500);
        }
        const authHeaders = {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
        };

        const body = (await request.json().catch(() => ({}))) as {
          action?: string;
          query?: string;
          lat?: number;
          lng?: number;
          sessionToken?: string;
          placeId?: string;
        };
        const sessionToken =
          typeof body.sessionToken === "string" ? body.sessionToken.slice(0, 64) : undefined;

        // ---------- details ----------
        if (body.action === "details") {
          const placeId = String(body.placeId ?? "").slice(0, 200);
          if (!placeId) return json({ error: "Missing place" }, 400);
          const url = new URL(
            `https://connector-gateway.lovable.dev/google_maps/places/v1/places/${encodeURIComponent(placeId)}`,
          );
          if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
          const res = await fetch(url.toString(), {
            headers: {
              ...authHeaders,
              // Only the fields we actually store, to keep this on the cheap SKU.
              "X-Goog-FieldMask": "id,location,formattedAddress,addressComponents",
            },
          });
          if (!res.ok) {
            console.error(`[places] details ${res.status}: ${await res.text()}`);
            return json({ error: "Place lookup failed" }, 502);
          }
          const d = (await res.json()) as {
            location?: { latitude: number; longitude: number };
            formattedAddress?: string;
            addressComponents?: Component[];
          };
          if (!d.location) return json({ error: "Place lookup failed" }, 502);
          const comps = d.addressComponents ?? [];
          return json({
            lat: d.location.latitude,
            lng: d.location.longitude,
            address: d.formattedAddress ?? "",
            pincode: pick(comps, ["postal_code"]),
            area:
              pick(comps, ["sublocality_level_1", "sublocality", "neighborhood"]) ??
              pick(comps, ["locality"]),
            city: pick(comps, ["locality"]) ?? pick(comps, ["administrative_area_level_3"]),
          });
        }

        // ---------- autocomplete ----------
        const query = String(body.query ?? "").trim().slice(0, 120);
        if (query.length < 3) return json({ suggestions: [] });

        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const origin =
          Number.isFinite(lat) && Number.isFinite(lng)
            ? { latitude: lat, longitude: lng }
            : LATUR;

        const res = await fetch(
          "https://connector-gateway.lovable.dev/google_maps/places/v1/places:autocomplete",
          {
            method: "POST",
            headers: {
              ...authHeaders,
              "Content-Type": "application/json",
              "X-Goog-FieldMask":
                "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.distanceMeters",
            },
            body: JSON.stringify({
              input: query,
              regionCode: "IN",
              includedRegionCodes: ["in"],
              origin,
              locationBias: { circle: { center: origin, radius: 35000 } },
              ...(sessionToken ? { sessionToken } : {}),
            }),
          },
        );
        if (!res.ok) {
          console.error(`[places] autocomplete ${res.status}: ${await res.text()}`);
          return json({ error: "Search failed" }, 502);
        }
        const data = (await res.json()) as {
          suggestions?: Array<{
            placePrediction?: {
              placeId?: string;
              distanceMeters?: number;
              structuredFormat?: {
                mainText?: { text?: string };
                secondaryText?: { text?: string };
              };
            };
          }>;
        };
        const mapped = (data.suggestions ?? [])
          .map((s) => s.placePrediction)
          .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
          .map((p) => ({
            placeId: p.placeId!,
            title: p.structuredFormat?.mainText?.text ?? "",
            area: p.structuredFormat?.secondaryText?.text ?? "",
            distanceMeters: typeof p.distanceMeters === "number" ? p.distanceMeters : null,
          }))
          .filter((s) => s.title.length > 0);

        // Nearest first: places inside the serviceable city radius come before
        // far-away same-name matches from other cities.
        const NEAR_METERS = 30_000;
        const rank = (d: number | null) => (d != null && d <= NEAR_METERS ? 0 : 1);
        const suggestions = mapped
          .sort((a, b) => {
            const r = rank(a.distanceMeters) - rank(b.distanceMeters);
            if (r !== 0) return r;
            return (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) -
              (b.distanceMeters ?? Number.MAX_SAFE_INTEGER);
          })
          .slice(0, 6);

        return json({ suggestions });
      },
    },
  },
});
