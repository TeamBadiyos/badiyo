// Razorpay webhook: server-side safety net for paid-but-unsaved bookings.
// Verifies the provider signature, then asks the database to make sure a
// booking exists for the payment — creating it from the saved order details
// when the client never managed to. Staff are alerted after repeated failures.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

type RazorpayPaymentEntity = {
  id?: string;
  order_id?: string;
  status?: string;
  notes?: Record<string, string> | null;
};

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const Route = createFileRoute("/api/public/webhooks/razorpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RAZORPAY_WEBHOOK_SECRET"];
        if (!secret) {
          console.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not configured");
          return new Response("Not configured", { status: 500 });
        }

        const raw = await request.text();
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        if (!signature || !safeEqual(signature, expected)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: {
          event?: string;
          payload?: { payment?: { entity?: RazorpayPaymentEntity } };
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const event = payload.event ?? "";
        if (event !== "payment.captured" && event !== "order.paid") {
          return new Response("ignored");
        }

        const entity = payload.payload?.payment?.entity ?? {};
        const paymentId = entity.id ?? null;
        const orderId = entity.order_id ?? null;
        if (!orderId) {
          console.error("[razorpay-webhook] event without order_id", event);
          return new Response("ok");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Retry a few times: transient database errors shouldn't lose a booking.
        let bookingId: string | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3 && !bookingId; attempt++) {
          const { data, error } = await supabaseAdmin.rpc(
            "system_fulfill_payment_intent" as never,
            { _order_id: orderId, _payment_id: paymentId } as never,
          );
          if (error) {
            lastError = error;
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          bookingId = (data as string | null) ?? null;
          if (!bookingId) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }

        if (!bookingId) {
          console.error(
            "[razorpay-webhook] could not ensure a booking for paid order",
            orderId,
            paymentId,
            lastError,
          );
          await supabaseAdmin.from("audit_logs").insert({
            actor_id: "00000000-0000-0000-0000-000000000000",
            action: "system_paid_booking_recovery_failed",
            target_table: "payment_intents",
            after_state: {
              razorpay_order_id: orderId,
              razorpay_payment_id: paymentId,
              source: "webhook",
            },
          });
          // 200 keeps Razorpay from hammering us; staff alert is already written.
          return new Response("recovery-failed");
        }

        return new Response("ok");
      },
    },
  },
});
