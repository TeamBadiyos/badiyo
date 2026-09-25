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

type RazorpayRefundEntity = {
  id?: string;
  payment_id?: string;
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
          payload?: {
            payment?: { entity?: RazorpayPaymentEntity };
            refund?: { entity?: RazorpayRefundEntity };
          };
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const event = payload.event ?? "";

        // Refund lifecycle: keep the booking's refund state in sync with what
        // Razorpay actually did, so the app never shows a refund that failed.
        if (event.startsWith("refund.")) {
          const refund = payload.payload?.refund?.entity ?? {};
          const bookingId = refund.notes?.booking_id;
          if (!bookingId) return new Response("ignored-refund");
          const status =
            event === "refund.processed"
              ? "refunded"
              : event === "refund.failed"
                ? "failed"
                : "processing";
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.rpc("system_set_booking_refund_state" as never, {
            _booking_id: bookingId,
            _refund_status: status,
            _refund_amount: null,
            _refund_id: refund.id ?? null,
            _refund_attempts: null,
            _refund_next_attempt_at: null,
            _refund_error:
              status === "failed" ? `Razorpay refund ${refund.id ?? ""} failed` : null,
          } as never);
          return new Response("ok-refund");
        }

        if (event !== "payment.captured" && event !== "order.paid") {
          return new Response("ignored");
        }


        const entity = payload.payload?.payment?.entity ?? {};
        const paymentId = entity.id ?? null;
        const orderId = entity.order_id ?? null;
        // Extension top-ups and tips are not bookings; the safety net must skip
        // them, otherwise every one raises a false "lost booking" alert.
        const purpose = entity.notes?.purpose;
        if (purpose === "extension" || purpose === "tip") {
          return new Response(`ignored-${purpose}`);
        }
        // Courier parcels are their own flow: mark paid and start the rider
        // search, or auto-refund when the payment lands after cancellation.
        // Store orders: safety net so a paid shop order is never left unpaid
        // when the app is closed before it can confirm.
        if (purpose === "store_order") {
          if (!orderId) return new Response("ignored-store");
          const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
          const { data: marked } = await admin.rpc("system_store_mark_paid" as never, {
            _rzp_order_id: orderId,
            _payment_id: paymentId,
          } as never);
          return new Response(marked ? "ok-store" : "store-not-found");
        }
        // Parcel return charge: only when the order id matches a return charge.
        if (purpose === "courier_return" && orderId) {
          const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
          const { data: marked } = await admin.rpc("courier_mark_charge_paid" as never, {
            _razorpay_order_id: orderId,
            _payment_id: paymentId,
          } as never);
          return new Response(marked ? "ok-return-charge" : "return-charge-not-found");
        }
        if (purpose === "courier") {
          const courierOrderId = entity.notes?.courier_order_id;
          if (!courierOrderId) return new Response("ignored-courier");
          const { markCourierPaid } = await import("@/lib/courier.functions");
          const result = await markCourierPaid(courierOrderId, paymentId);
          return new Response(result.ok ? "ok-courier" : "courier-not-found");
        }
        // Business delivery wallet top-up: credit the merchant's delivery wallet.
        // The paid amount always comes from the Razorpay entity, never from notes.
        if (purpose === "merchant_wallet_topup") {
          if (!orderId) return new Response("ignored-topup");
          const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
          const paidRupees = typeof entity.amount === "number" ? entity.amount / 100 : null;
          const { data: confirmed } = await admin.rpc("business_confirm_topup" as never, {
            _razorpay_order_id: orderId,
            _payment_id: paymentId,
            _amount_paid: paidRupees,
          } as never);
          return new Response(confirmed ? "ok-topup" : "topup-not-confirmed");
        }
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
          // No payment intent for this order means it was never a booking
          // checkout (extension top-ups and other payments create no intent).
          // The database already audits that case, so don't raise a
          // "lost booking" alert for it.
          const { data: intent } = await supabaseAdmin
            .from("payment_intents")
            .select("id, status, last_error, attempts")
            .eq("razorpay_order_id", orderId)
            .maybeSingle();

          if (!intent) {
            console.warn(
              "[razorpay-webhook] paid order has no booking intent (non-booking payment)",
              orderId,
              paymentId,
            );
            return new Response("no-intent");
          }

          // Surface the real database error so the cause is visible in logs
          // instead of a bare "null" from the RPC result.
          console.error(
            "[razorpay-webhook] could not ensure a booking for paid order",
            orderId,
            paymentId,
            lastError,
            "intent:",
            JSON.stringify(intent),
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
