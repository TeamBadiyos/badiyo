// Courier OTP helpers: resend over WhatsApp, refresh an expired code, and
// change the pickup/drop contact number. All gating (owner, stage, cooldown,
// caps) lives in the database RPCs; this layer only does the WhatsApp send.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const purposeSchema = z.enum(["pickup", "delivery"]);

const orderPurpose = z.object({
  order_id: z.string().uuid(),
  purpose: purposeSchema,
});

/** Sends the code through the existing AiSensy WhatsApp campaign. */
async function sendWhatsAppOtp(phone: string, code: string): Promise<string | null> {
  const apiKey = process.env["AISENSY_API_KEY"];
  const campaignName =
    process.env["AISENSY_COURIER_OTP_CAMPAIGN"] ?? process.env["AISENSY_CAMPAIGN_NAME"];
  if (!apiKey) return "WhatsApp not configured";
  if (!campaignName) return "WhatsApp campaign not configured";

  const digits = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return "Invalid contact number";
  const destination = `+91${digits}`;

  try {
    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName,
        destination,
        userName: digits,
        templateParams: [code],
        buttons: [
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: code }],
          },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      let detail = text;
      try {
        detail = (JSON.parse(text) as { message?: string })?.message ?? text;
      } catch {
        /* keep raw */
      }
      return `AiSensy: ${String(detail).slice(0, 300)}`;
    }
    return null;
  } catch (err) {
    return (err as Error).message || "WhatsApp send failed";
  }
}

/**
 * Customer taps "Send on WhatsApp" / "Resend". Never called automatically.
 * A failed send still returns the code so the app can show it.
 */
export const resendCourierOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => orderPurpose.parse(data))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("courier_resend_otp", {
      _order_id: data.order_id,
      _purpose: data.purpose,
    });
    if (error) throw new Error(error.message);

    const payload = res as {
      otp: string;
      phone: string | null;
      sends_used: number;
      max_sends: number;
    };

    const sendError = await sendWhatsAppOtp(payload.phone ?? "", payload.otp);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .rpc("courier_log_otp_send", {
        _order_id: data.order_id,
        _purpose: data.purpose,
        _ok: !sendError,
        _detail: sendError ?? "sent",
      })
      .then(
        () => undefined,
        () => undefined,
      );

    return {
      otp: payload.otp,
      sends_used: payload.sends_used,
      max_sends: payload.max_sends,
      sent: !sendError,
      send_error: sendError,
    };
  });

/** Issues a brand new code after the old one expired. */
export const refreshCourierOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => orderPurpose.parse(data))
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("courier_refresh_otp", {
      _order_id: data.order_id,
      _purpose: data.purpose,
    });
    if (error) throw new Error(error.message);
    return res as { otp: string; purpose: string };
  });

/** Changes the pickup or drop contact number (re-issues that OTP). */
export const updateCourierContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    orderPurpose.extend({ new_phone: z.string().min(10).max(15) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("courier_update_contact", {
      _order_id: data.order_id,
      _purpose: data.purpose,
      _new_phone: data.new_phone,
    });
    if (error) throw new Error(error.message);
    return res as { changed: boolean; phone: string; edits_used?: number; edit_cap?: number };
  });
