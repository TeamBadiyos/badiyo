// Idempotent courier refund worker.
// Called by a scheduled database job with a shared secret. Each order is
// refunded at most once: Razorpay is given a stable idempotency key built from
// the order id and its refund reason, and a successful refund is recorded.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/courier/process-refunds")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-courier-job-secret") ?? "";
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const keyId = process.env["RAZORPAY_KEY_ID"];
        const keySecret = process.env["RAZORPAY_KEY_SECRET"];
        if (!keyId || !keySecret) return new Response("Payments not configured", { status: 500 });
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // The shared secret lives only in the database vault.
        const { data: valid } = await supabaseAdmin.rpc(
          "courier_verify_job_secret" as never,
          { _secret: provided } as never,
        );
        if (valid !== true) return new Response("Unauthorized", { status: 401 });
        const { data: rows, error } = await supabaseAdmin
          .from("courier_orders")
          .select("id, razorpay_payment_id, refund_amount, refund_attempts, refund_reason")
          .eq("refund_status", "refund_pending")
          .lte("refund_next_attempt_at", new Date().toISOString())
          .gt("refund_amount", 0)
          .limit(20);
        if (error) {
          console.error("[courier-refunds] query failed", error);
          return new Response("query-failed", { status: 500 });
        }

        let done = 0;
        let failed = 0;

        for (const row of rows ?? []) {
          const attempts = (row.refund_attempts ?? 0) + 1;

          // Nothing was charged (no payment, or a fully-discounted ₹0 order):
          // there is no gateway refund to make.
          if (
            !row.razorpay_payment_id ||
            row.razorpay_payment_id.startsWith("free_") ||
            Math.round(Number(row.refund_amount ?? 0) * 100) <= 0
          ) {
            await supabaseAdmin
              .from("courier_orders")
              .update({
                refund_status: "done",
                payment_status: "refunded",
                refund_attempts: attempts,
              })
              .eq("id", row.id);
            done++;
            continue;
          }

          // Atomically claim the row so a second worker can't refund it again.
          const { data: claimed } = await supabaseAdmin
            .from("courier_orders")
            .update({ refund_status: "processing", refund_attempts: attempts })
            .eq("id", row.id)
            .eq("refund_status", "refund_pending")
            .select("id");
          if (!claimed || claimed.length === 0) continue;

          const markRefunded = async (refundId: string | null) => {
            await supabaseAdmin
              .from("courier_orders")
              .update({
                refund_status: "done",
                payment_status: "refunded",
                needs_ops_attention: false,
                ...(refundId ? { refund_id: refundId } : {}),
              })
              .eq("id", row.id);
          };

          try {
            // Reconcile first: the money may already be back with the customer
            // (earlier attempt succeeded but the status write didn't land).
            try {
              const existing = await fetch(
                `https://api.razorpay.com/v1/payments/${encodeURIComponent(row.razorpay_payment_id)}/refunds`,
                { headers: { Authorization: `Basic ${auth}` } },
              );
              if (existing.ok) {
                const list = (await existing.json()) as {
                  items?: Array<{ id?: string; amount?: number; status?: string }>;
                };
                const items = (list.items ?? []).filter((r) => r.status !== "failed");
                const refundedPaise = items.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
                if (refundedPaise >= Math.round(Number(row.refund_amount) * 100)) {
                  await markRefunded(items[items.length - 1]?.id ?? null);
                  done++;
                  continue;
                }
              }
            } catch (listErr) {
              console.error("[courier-refunds] refund lookup failed", row.id, listErr);
            }

            const res = await fetch(
              `https://api.razorpay.com/v1/payments/${encodeURIComponent(row.razorpay_payment_id)}/refund`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Basic ${auth}`,
                  // Stable key: repeated calls return the same refund.
                  "X-Payment-Idempotency": `courier_${row.id}_${row.refund_reason ?? "refund"}`,
                },
                body: JSON.stringify({
                  amount: Math.round(Number(row.refund_amount) * 100),
                  speed: "normal",
                  notes: { courier_order_id: row.id, reason: row.refund_reason ?? "" },
                }),
              },
            );

            if (res.ok) {
              const refund = (await res.json()) as { id?: string };
              await supabaseAdmin
                .from("courier_orders")
                .update({
                  refund_status: "done",
                  payment_status: "refunded",
                  refund_id: refund.id ?? null,
                })
                .eq("id", row.id);
              done++;
            } else {
              const text = await res.text();
              console.error("[courier-refunds] razorpay refused", row.id, res.status, text);
              const giveUp = attempts >= 5;
              await supabaseAdmin
                .from("courier_orders")
                .update({
                  refund_status: giveUp ? "failed" : "refund_pending",
                  needs_ops_attention: giveUp,
                  refund_next_attempt_at: new Date(
                    Date.now() + Math.min(60, 2 ** attempts) * 60_000,
                  ).toISOString(),
                })
                .eq("id", row.id);
              failed++;
            }
          } catch (err) {
            console.error("[courier-refunds] refund call failed", row.id, err);
            await supabaseAdmin
              .from("courier_orders")
              .update({
                refund_status: "refund_pending",
                refund_next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
              })
              .eq("id", row.id);
            failed++;
          }
        }

        return Response.json({ processed: (rows ?? []).length, done, failed });
      },
    },
  },
});
