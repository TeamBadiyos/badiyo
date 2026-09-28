// Daily retention cleanup for drop-proof photos. Called by pg_cron (via pg_net)
// with the shared courier job secret.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/proof/cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-courier-job-secret") ?? "";
        if (!provided) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const admin = supabaseAdmin as any;
        const { data: valid } = await admin.rpc("courier_verify_job_secret", { _secret: provided });
        if (valid !== true) return new Response("Unauthorized", { status: 401 });

        let removed = 0;
        for (let round = 0; round < 10; round++) {
          const { data: rows, error } = await admin.rpc("business_proof_expired", { _limit: 500 });
          if (error) {
            console.error("[proof-cleanup] list failed", error);
            break;
          }
          const list = (rows ?? []) as Array<{ id: string; storage_path: string }>;
          if (list.length === 0) break;
          const { error: re } = await supabaseAdmin.storage
            .from("delivery-proofs")
            .remove(list.map((r) => r.storage_path));
          if (re) {
            console.error("[proof-cleanup] remove failed", re);
            break;
          }
          const { data: n } = await admin.rpc("business_proof_purge", { _ids: list.map((r) => r.id) });
          removed += Number(n ?? 0);
          if (list.length < 500) break;
        }
        return Response.json({ removed });
      },
    },
  },
});
