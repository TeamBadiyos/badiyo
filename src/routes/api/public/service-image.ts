// Public, aggressively cached image proxy for the private `service-images`
// bucket.
//
// Images used to be served from an external proxy on badiyos.com with a
// 1-hour cache and 1.5-3.5s time-to-first-byte, which made the home screen
// feel frozen. Serving them from this app lets us cache them immutably
// (object paths already contain a timestamp, so they never change) and
// optionally ask Supabase for a resized variant.
import { createFileRoute } from "@tanstack/react-router";

const BUCKET = "service-images";
const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";

function badRequest(message: string) {
  return new Response(message, { status: 400, headers: { "Cache-Control": "no-store" } });
}

/** Reject traversal / absolute paths — only plain object keys are allowed. */
function safePath(raw: string | null): string | null {
  if (!raw) return null;
  let path = raw.trim().replace(/^\/+/, "");
  if (!path) return null;
  if (path.startsWith(`${BUCKET}/`)) path = path.slice(BUCKET.length + 1);
  if (path.includes("..") || path.includes("\\") || /^[a-z]+:/i.test(path)) return null;
  return path;
}

export const Route = createFileRoute("/api/public/service-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const path = safePath(url.searchParams.get("path"));
        if (!path) return badRequest("Missing or invalid path");

        // `w` is accepted and ignored: it only varies the cache key so different
        // render sizes can be tuned later without changing call sites. Storage
        // image transforms are not enabled on this project, and asking for one
        // costs a second round-trip that returns the original anyway.

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
        if (error || !data) {
          return new Response("Not found", {
            status: 404,
            headers: { "Cache-Control": "public, max-age=60" },
          });
        }

        return new Response(await data.arrayBuffer(), {
          headers: {
            "Content-Type": data.type || "image/jpeg",
            "Cache-Control": IMMUTABLE,
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
          },
        });
      },
    },
  },
});
