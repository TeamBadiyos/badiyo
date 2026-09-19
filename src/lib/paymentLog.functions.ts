import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  razorpay_order_id: z.string().max(120).optional().nullable(),
  purpose: z.string().max(40).optional().nullable(),
  category: z.string().max(40),
  raw: z.string().max(4000),
  parsed: z.record(z.string(), z.unknown()).optional().nullable(),
});

/**
 * Stores the full raw payment failure server-side for debugging.
 * Nothing here is ever rendered to the customer.
 */
export const logPaymentFailure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const detail = {
      category: data.category,
      purpose: data.purpose ?? null,
      razorpay_order_id: data.razorpay_order_id ?? null,
      parsed: data.parsed ?? null,
      raw: data.raw,
    };

    try {
      await supabaseAdmin.from("audit_logs").insert({
        actor_id: context.userId,
        action: "payment_failed",
        target_table: "payment_intents",
        target_id: null,
        after_state: JSON.parse(JSON.stringify(detail)),
      });
    } catch {
      /* logging must never break the payment screen */
    }

    if (data.razorpay_order_id) {
      try {
        await supabaseAdmin
          .from("payment_intents")
          .update({ last_error: `${data.category}: ${data.raw}`.slice(0, 2000) })
          .eq("razorpay_order_id", data.razorpay_order_id);
      } catch {
        /* ignore */
      }
    }

    return { ok: true };
  });
