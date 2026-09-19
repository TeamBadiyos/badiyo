// Temporary admin WhatsApp alert worker.
// Woken by the database (pg_net) whenever a paid order is queued. Guarded by a
// shared secret that lives only in the database vault. Sends one AiSensy
// template message per queued order (4 variables) to the admin numbers.
import { createFileRoute } from "@tanstack/react-router";

type QueueRow = {
  id: string;
  order_type: string;
  order_id: string;
  v_order: string;
  v_customer: string;
  v_amount: string;
  v_time: string;
  attempts: number;
};

export const Route = createFileRoute("/api/public/admin-alert/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-admin-alert-secret") ?? "";
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: valid } = await supabaseAdmin.rpc(
          "admin_alert_verify_job_secret" as never,
          { _secret: provided } as never,
        );
        if (valid !== true) return new Response("Unauthorized", { status: 401 });

        const apiKey = process.env["AISENSY_API_KEY"];
        const campaignName = process.env["AISENSY_ADMIN_ALERT_CAMPAIGN"];
        const phonesRaw = process.env["ADMIN_ALERT_PHONES"];
        if (!apiKey || !campaignName || !phonesRaw) {
          console.error("[admin-alert] not configured");
          return new Response("Not configured", { status: 500 });
        }

        const destinations = phonesRaw
          .split(",")
          .map((p) => p.replace(/\D/g, "").slice(-10))
          .filter((p) => p.length === 10)
          .map((p) => `+91${p}`);
        if (destinations.length === 0) {
          console.error("[admin-alert] no valid admin phone numbers configured");
          return new Response("Not configured", { status: 500 });
        }

        const { data: rows, error } = await supabaseAdmin.rpc(
          "admin_alert_claim_batch" as never,
          { _limit: 20 } as never,
        );
        if (error) {
          console.error("[admin-alert] claim failed", error);
          return new Response("claim-failed", { status: 500 });
        }

        let sent = 0;
        let failed = 0;

        for (const row of (rows ?? []) as QueueRow[]) {
          try {
            const params = [row.v_order, row.v_customer, row.v_amount, row.v_time];
            const results = await Promise.all(
              destinations.map(async (destination) => {
                const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    apiKey,
                    campaignName,
                    destination,
                    userName: "Badiyos Admin",
                    templateParams: params,
                  }),
                });
                return { ok: res.ok, text: res.ok ? "" : await res.text() };
              }),
            );

            const firstFailure = results.find((r) => !r.ok);
            if (firstFailure) {
              failed++;
              await supabaseAdmin.rpc("admin_alert_mark" as never, {
                _id: row.id,
                _ok: false,
                _error: firstFailure.text.slice(0, 400),
              } as never);
            } else {
              sent++;
              await supabaseAdmin.rpc("admin_alert_mark" as never, {
                _id: row.id,
                _ok: true,
                _error: null,
              } as never);
            }
          } catch (err) {
            failed++;
            console.error("[admin-alert] send failed", row.order_type, err);
            await supabaseAdmin
              .rpc("admin_alert_mark" as never, {
                _id: row.id,
                _ok: false,
                _error: String((err as Error)?.message ?? err).slice(0, 400),
              } as never)
              .then(() => undefined, () => undefined);
          }
        }

        return Response.json({ processed: (rows ?? []).length, sent, failed });
      },
    },
  },
});
