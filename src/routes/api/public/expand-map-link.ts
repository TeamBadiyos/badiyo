// Expands short Google Maps share links (maps.app.goo.gl) to their full URL so
// the app can read the coordinates. Only Google short-link hosts are followed;
// it returns nothing but the final Google Maps URL, so it is not an open proxy.
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SHORT = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i;
const GOOGLE = /^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl|g\.co)\//i;

export const Route = createFileRoute("/api/public/expand-map-link")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: CORS }),
      POST: async ({ request }) => {
        const { url } = (await request.json().catch(() => ({}))) as { url?: string };
        let current = String(url ?? "").trim().replace(/^http:/i, "https:");
        if (!SHORT.test(current) || current.length > 300) return json({ error: "Unsupported link" }, 400);
        for (let i = 0; i < 5; i++) {
          const res = await fetch(current, { redirect: "manual" });
          const loc = res.headers.get("location");
          if (!loc || res.status < 300 || res.status >= 400) break;
          const next = new URL(loc, current).toString();
          if (!GOOGLE.test(next)) return json({ error: "Unsupported link" }, 400);
          current = next;
        }
        return json({ url: current });
      },
    },
  },
});
