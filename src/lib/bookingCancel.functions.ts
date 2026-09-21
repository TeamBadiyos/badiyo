// Customer-initiated booking cancellation with a real gateway refund.
//
// Everything that decides money happens here on the server: the cancellation
// fee comes from ops_settings, the refundable amount is derived from what was
// actually paid, and the Razorpay refund is created with a stable idempotency
// key so a retry can never refund twice. If the gateway call fails the booking
// is parked as `pending` and the refund worker retries it — we never tell the
// customer a refund is on its way unless the gateway accepted it.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RefundOutcome =
  | "processing" // gateway accepted the refund
  | "not_applicable" // nothing was charged (free / fully discounted order)
  | "pending" // gateway call failed, retry worker will pick it up
  | "none"; // fee consumed the whole amount, nothing to refund

export type CancelBookingResult = {
  ok: true;
  cancellation_fee: number;
  refund_amount: number;
  refund_status: RefundOutcome;
  refund_id: string | null;
};

const CANCELLABLE = new Set(["confirmed", "accepted", "expert_assigned"]);

function isGatewayPayment(paymentId: string | null | undefined): boolean {
  return !!paymentId && !paymentId.startsWith("free_");
}

export const cancelBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string }) => {
    if (!data?.bookingId || typeof data.bookingId !== "string") {
      throw new Error("Booking id is required");
    }
    return { bookingId: data.bookingId };
  })
  .handler(async ({ data, context }): Promise<CancelBookingResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // RLS keeps this scoped to the signed-in customer's own booking.
    const { data: booking, error } = await context.supabase
      .from("bookings")
      .select(
        "id, status, total_amount, assigned_expert_id, razorpay_payment_id, refund_status",
      )
      .eq("id", data.bookingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!booking) throw new Error("Booking not found");
    if (!CANCELLABLE.has(booking.status)) {
      throw new Error("This booking can no longer be cancelled.");
    }

    const paid = Math.max(0, Number(booking.total_amount ?? 0));
    const charged = isGatewayPayment(booking.razorpay_payment_id) && paid > 0;

    // Fee depends on how far the booking got: nothing while we're still
    // searching, the configured fee once an expert is on the job.
    const feeKey = booking.assigned_expert_id
      ? "booking_cancel_fee_assigned"
      : "booking_cancel_fee_searching";
    const { data: setting } = await supabaseAdmin
      .from("ops_settings")
      .select("value")
      .eq("key", feeKey)
      .maybeSingle();
    const configuredFee = Math.max(0, Number(setting?.value ?? 0) || 0);

    const fee = charged ? Math.min(configuredFee, paid) : 0;
    const refundAmount = charged ? Math.max(0, Math.round((paid - fee) * 100) / 100) : 0;

    let refundStatus: RefundOutcome = "not_applicable";
    let refundId: string | null = null;
    let refundError: string | null = null;

    if (refundAmount > 0) {
      const keyId = process.env["RAZORPAY_KEY_ID"];
      const keySecret = process.env["RAZORPAY_KEY_SECRET"];
      if (!keyId || !keySecret) {
        refundStatus = "pending";
        refundError = "Payments not configured";
      } else {
        try {
          const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
          const res = await fetch(
            `https://api.razorpay.com/v1/payments/${encodeURIComponent(
              booking.razorpay_payment_id as string,
            )}/refund`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${auth}`,
                // Stable key: a retry returns the original refund.
                "X-Payment-Idempotency": `booking_${booking.id}_cancel`,
              },
              body: JSON.stringify({
                amount: Math.round(refundAmount * 100),
                speed: "normal",
                notes: { booking_id: booking.id, reason: "customer_cancelled" },
              }),
            },
          );
          if (res.ok) {
            const refund = (await res.json()) as { id?: string };
            refundId = refund.id ?? null;
            refundStatus = "processing";
          } else {
            refundError = `${res.status} ${await res.text()}`.slice(0, 500);
            refundStatus = "pending";
            console.error("[booking-cancel] razorpay refused", booking.id, refundError);
          }
        } catch (err) {
          refundError = String(err).slice(0, 500);
          refundStatus = "pending";
          console.error("[booking-cancel] refund call failed", booking.id, err);
        }
      }
    } else if (charged) {
      // Whole payment was eaten by the cancellation fee.
      refundStatus = "none";
    }

    const { error: rpcError } = await context.supabase.rpc(
      "customer_cancel_booking_apply" as never,
      {
        _booking_id: booking.id,
        _cancellation_fee: fee,
        _refund_amount: refundAmount,
        _refund_id: refundId,
        _refund_status: refundStatus,
      } as never,
    );
    if (rpcError) throw new Error(rpcError.message);

    // Bookkeeping for the retry worker (server-only: booking rows are guarded).
    await supabaseAdmin.rpc("system_set_booking_refund_state" as never, {
      _booking_id: booking.id,
      _refund_status: refundStatus,
      _refund_amount: refundAmount,
      _refund_id: refundId,
      _refund_attempts: refundAmount > 0 ? 1 : 0,
      _refund_next_attempt_at:
        refundStatus === "pending" ? new Date(Date.now() + 60_000).toISOString() : null,
      _refund_error: refundError,
    } as never);


    return {
      ok: true,
      cancellation_fee: fee,
      refund_amount: refundAmount,
      refund_status: refundStatus,
      refund_id: refundId,
    };
  });

/** Fee that would apply right now, so the confirm dialog can tell the truth. */
export const getCancellationQuote = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string }) => ({ bookingId: String(data?.bookingId ?? "") }))
  .handler(async ({ data, context }) => {
    const { data: booking } = await context.supabase
      .from("bookings")
      .select("id, total_amount, assigned_expert_id, razorpay_payment_id")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (!booking) throw new Error("Booking not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const feeKey = booking.assigned_expert_id
      ? "booking_cancel_fee_assigned"
      : "booking_cancel_fee_searching";
    const { data: setting } = await supabaseAdmin
      .from("ops_settings")
      .select("value")
      .eq("key", feeKey)
      .maybeSingle();

    const paid = Math.max(0, Number(booking.total_amount ?? 0));
    const charged = isGatewayPayment(booking.razorpay_payment_id) && paid > 0;
    const fee = charged ? Math.min(Math.max(0, Number(setting?.value ?? 0) || 0), paid) : 0;
    return {
      paid,
      cancellation_fee: fee,
      refund_amount: charged ? Math.max(0, Math.round((paid - fee) * 100) / 100) : 0,
    };
  });
