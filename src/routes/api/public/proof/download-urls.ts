// Short-lived signed download links for drop-proof photos (max 300 per call).
// Access is decided in SQL as the caller (business_proof_readable_paths).
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const Body = z.object({ paths: z.array(z.string().min(1).max(300)).min(1).max(300) });

export const Route = createFileRoute("/api/public/proof/download-urls")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return Response.json({ ok: false, reason: "UNAUTHORIZED" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, reason: "BAD_REQUEST" }, { status: 400 });

        const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
        const userClient = createClient(process.env["SUPABASE_URL"]!, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: allowed, error } = await (userClient as any).rpc("business_proof_readable_paths", {
          _paths: parsed.data.paths,
        });
        if (error) return Response.json({ ok: false, reason: "FORBIDDEN" }, { status: 403 });
        const paths = (allowed ?? []) as string[];
        if (paths.length === 0) return Response.json({ ok: true, urls: [] });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error: se } = await supabaseAdmin.storage.from("delivery-proofs").createSignedUrls(paths, 300);
        if (se) {
          console.error("[proof-download-urls] sign failed", se);
          return Response.json({ ok: false, reason: "SERVER_ERROR" }, { status: 500 });
        }
        return Response.json({
          ok: true,
          urls: (data ?? []).map((d) => ({ path: d.path, url: d.signedUrl })),
        });
      },
    },
  },
});
