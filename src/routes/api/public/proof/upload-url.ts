// Rider asks for a signed upload link for one drop-proof photo.
// Auth: rider's Supabase bearer token. Eligibility rules live in SQL
// (business_proof_upload_check), the service role is used only to sign.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ stop_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/proof/upload-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return Response.json({ ok: false, reason: "UNAUTHORIZED" }, { status: 401 });
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false, reason: "BAD_REQUEST" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: u, error: ue } = await supabaseAdmin.auth.getUser(token);
        if (ue || !u.user) return Response.json({ ok: false, reason: "UNAUTHORIZED" }, { status: 401 });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: check, error } = await (supabaseAdmin as any).rpc("business_proof_upload_check", {
          _stop_id: parsed.data.stop_id,
          _uid: u.user.id,
        });
        if (error) {
          console.error("[proof-upload-url] check failed", error);
          return Response.json({ ok: false, reason: "SERVER_ERROR" }, { status: 500 });
        }
        const c = check as { ok: boolean; reason?: string; path?: string };
        if (!c?.ok || !c.path) return Response.json(c, { status: 403 });

        const { data: signed, error: se } = await supabaseAdmin.storage
          .from("delivery-proofs")
          .createSignedUploadUrl(c.path);
        if (se || !signed) {
          console.error("[proof-upload-url] sign failed", se);
          return Response.json({ ok: false, reason: "SERVER_ERROR" }, { status: 500 });
        }
        return Response.json({ ok: true, path: c.path, signed_url: signed.signedUrl, token: signed.token });
      },
    },
  },
});
