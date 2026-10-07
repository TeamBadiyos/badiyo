// Fast, cached image route for store and product photos.
// Only serves paths that are a currently visible product/store photo (so
// private merchant documents can never leak). Prefers the lightweight WebP
// copy under product-images/_thumbs/<bucket>/<path>.webp, else the original.
import { createFileRoute } from "@tanstack/react-router";

const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";

export const Route = createFileRoute("/api/public/store-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind") === "store" ? "store" : "product";
        const path = (url.searchParams.get("path") ?? "").trim().replace(/^\/+/, "");
        if (!path || path.includes("..") || /^[a-z]+:/i.test(path)) {
          return new Response("Bad path", { status: 400 });
        }

        const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
        const cacheKey = new Request(url.toString(), { method: "GET" });
        if (edge) {
          const hit = await edge.match(cacheKey).catch(() => undefined);
          if (hit) return hit;
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const view = kind === "store" ? "public_stores" : "public_products";
        const { data: row } = await supabaseAdmin.from(view).select("id").eq("photo_url", path).limit(1).maybeSingle();
        if (!row) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });

        const primary = kind === "store" ? "merchant-documents" : "product-images";
        const secondary = kind === "store" ? "product-images" : "merchant-documents";
        let blob: Blob | null = null;
        for (const b of [primary, secondary]) {
          const t = await supabaseAdmin.storage.from("product-images").download(`_thumbs/${b}/${path}.webp`);
          if (t.data) { blob = t.data; break; }
        }
        if (!blob) {
          for (const b of [primary, secondary]) {
            const o = await supabaseAdmin.storage.from(b).download(path);
            if (o.data) { blob = o.data; break; }
          }
        }
        if (!blob) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });

        const res = new Response(await blob.arrayBuffer(), {
          headers: {
            "Content-Type": blob.type || "image/webp",
            "Cache-Control": IMMUTABLE,
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
          },
        });
        if (edge) await edge.put(cacheKey, res.clone()).catch(() => {});
        return res;
      },
    },
  },
});
