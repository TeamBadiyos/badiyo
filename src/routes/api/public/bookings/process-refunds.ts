// Idempotent booking refund worker.
// Woken by the database as soon as a refund is parked as `pending`, and again
// by the background sweeper once a backoff window has passed. Each booking is
// refunded at most once thanks to a stable Razorpay idempotency key.
import { createFileRoute } from "@tanstack/react-router";

const MAX_ATTEMPTS = 6;

export const Route = createFileRoute("/api/public/bookings/process-refunds")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-job-secret") ?? "";
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const keyId = process.env["RAZORPAY_KEY_ID"];
        const keySecret = process.env["RAZORPAY_KEY_SECRET"];
        if (!keyId || !keySecret) return new Response("Payments not configured", { status: 500 });
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: valid } = await supabaseAdmin.rpc(
          "booking_verify_job_secret" as never,
          { _secret: provided } as never,
        );
        if (valid !== true) return new Response("Unauthorized", { status: 401 });

        const { data: rows, error } = await supabaseAdmin
          .from("bookings")
          .select("id, razorpay_payment_id, refund_amount, refund_attempts")
          .eq("refund_status", "pending")
          .gt("refund_amount", 0)
          .or(`refund_next_attempt_at.is.null,refund_next_attempt_at.lte.${new Date().toISOString()}`)
          .limit(20);
        if (error) {
          console.error("[booking-refunds] query failed", error);
          return new Response("query-failed", { status: 500 });
        }

        let done = 0;
        let failed = 0;

        for (const row of rows ?? []) {
          const attempts = (row.refund_attempts ?? 0) + 1;
          const amountPaise = Math.round(Number(row.refund_amount ?? 0) * 100);

          // Nothing was actually charged — there is no gateway refund to make.
          if (
            !row.razorpay_payment_id ||
            row.razorpay_payment_id.startsWith("free_") ||
            amountPaise <= 0
          ) {
            await supabaseAdmin
              .from("bookings")
              .update({
                refund_status: "not_applicable",
                refund_attempts: attempts,
                refund_next_attempt_at: null,
                refund_error: null,
              })
              .eq("id", row.id);
            done++;
            continue;
          }

          try {
            const res = await fetch(
              `https://api.razorpay.com/v1/payments/${encodeURIComponent(row.razorpay_payment_id)}/refund`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Basic ${auth}`,
                  "X-Payment-Idempotency": `booking_${row.id}_cancel`,
                },
                body: JSON.stringify({
                  amount: amountPaise,
                  speed: "normal",
                  notes: { booking_id: row.id, reason: "customer_cancelled" },
                }),
              },
            );

            if (res.ok) {
              const refund = (await res.json()) as { id?: string };
              await supabaseAdmin
                .from("bookings")
                .update({
                  refund_status: "processing",
                  refund_id: refund.id ?? null,
                  refund_attempts: attempts,
                  refund_next_attempt_at: null,
                  refund_error: null,
                })
                .eq("id", row.id);
              done++;
            } else {
              const text = (await res.text()).slice(0, 500);
              console.error("[booking-refunds] razorpay refused", row.id, res.status, text);
              const giveUp = attempts >= MAX_ATTEMPTS;
              await supabaseAdmin
                .from("bookings")
                .update({
                  refund_status: giveUp ? "failed" : "pending",
                  refund_attempts: attempts,
                  refund_error: `${res.status} ${text}`,
                  refund_next_attempt_at: giveUp
                    ? null
                    : new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString(),
                })
                .eq("id", row.id);
              if (giveUp) {
                await supabaseAdmin.from("audit_logs").insert({
                  actor_id: "00000000-0000-0000-0000-000000000000",
                  action: "booking_refund_failed",
                  target_table: "bookings",
                  target_id: row.id,
                  after_state: { refund_amount: row.refund_amount, error: text },
                });
              }
              failed++;
            }
          } catch (err) {
            console.error("[booking-refunds] refund call failed", row.id, err);
            await supabaseAdmin
              .from("bookings")
              .update({
                refund_attempts: attempts,
                refund_error: String(err).slice(0, 500),
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
