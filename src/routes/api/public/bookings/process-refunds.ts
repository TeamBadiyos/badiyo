// Idempotent booking refund worker.
// Woken by the database as soon as a refund is parked as `pending`, and again
// by the background sweeper once a backoff window has passed. Each booking is
// refunded at most once thanks to a stable Razorpay idempotency key.
import { createFileRoute } from "@tanstack/react-router";

// Booking rows are protected by a database guard: refund bookkeeping has to go
// through this server-only function instead of a direct table update.
type AdminClient = { rpc: (fn: never, args: never) => PromiseLike<unknown> };
async function setRefundState(
  admin: AdminClient,
  opts: {
    id: string;
    status: string;
    refundId?: string | null;
    amount?: number | null;
    attempts?: number | null;
    nextAttemptAt?: string | null;
    error?: string | null;
  },
) {
  await admin.rpc("system_set_booking_refund_state" as never, {
    _booking_id: opts.id,
    _refund_status: opts.status,
    _refund_amount: opts.amount ?? null,
    _refund_id: opts.refundId ?? null,
    _refund_attempts: opts.attempts ?? null,
    _refund_next_attempt_at: opts.nextAttemptAt ?? null,
    _refund_error: opts.error ?? null,
  } as never);
}

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
            await setRefundState(supabaseAdmin, {
              id: row.id,
              status: "not_applicable",
              attempts,
            });
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
              await setRefundState(supabaseAdmin, {
                id: row.id,
                status: "processing",
                refundId: refund.id ?? null,
                attempts,
              });
              done++;
            } else {
              const text = (await res.text()).slice(0, 500);
              console.error("[booking-refunds] razorpay refused", row.id, res.status, text);
              const giveUp = attempts >= MAX_ATTEMPTS;
              await setRefundState(supabaseAdmin, {
                id: row.id,
                status: giveUp ? "failed" : "pending",
                attempts,
                error: `${res.status} ${text}`,
                nextAttemptAt: giveUp
                  ? null
                  : new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString(),
              });
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
            await setRefundState(supabaseAdmin, {
              id: row.id,
              status: "pending",
              attempts,
              error: String(err).slice(0, 500),
              nextAttemptAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            });
            failed++;
          }
        }

        return Response.json({ processed: (rows ?? []).length, done, failed });
      },
    },
  },
});
