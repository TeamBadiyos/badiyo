import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_TIPS = [25, 50, 100] as const;

const schema = z.object({
  booking_id: z.string().uuid(),
  amount: z.number(),
  razorpay_payment_id: z.string().min(3),
  razorpay_order_id: z.string().min(3).optional(),
});

/**
 * Records a customer tip only after the payment has been verified directly
 * with Razorpay (captured/authorized, correct amount, matching order).
 */
export const recordTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data, context }) => {
    if (!ALLOWED_TIPS.includes(data.amount as (typeof ALLOWED_TIPS)[number])) {
      throw new Error("Invalid tip amount");
    }

    const keyId = process.env["RAZORPAY_KEY_ID"];
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keyId || !keySecret) throw new Error("Payments are not configured");

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(data.razorpay_payment_id)}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!res.ok) throw new Error("Could not verify this payment");

    const payment = (await res.json()) as {
      amount?: number;
      status?: string;
      order_id?: string;
    };

    if (payment.status !== "captured" && payment.status !== "authorized") {
      throw new Error("Payment not completed");
    }
    if (payment.amount !== Math.round(data.amount * 100)) {
      throw new Error("Payment amount mismatch");
    }
    if (data.razorpay_order_id && payment.order_id !== data.razorpay_order_id) {
      throw new Error("Payment does not match this order");
    }

    const { data: tipId, error } = await context.supabase.rpc("record_booking_tip", {
      _booking_id: data.booking_id,
      _amount: data.amount,
      _razorpay_payment_id: data.razorpay_payment_id,
    });
    if (error) throw new Error(error.message);

    return { tip_id: tipId as string };
  });
