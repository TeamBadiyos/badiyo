import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PhoneSchema = z.object({
  phone: z.string().regex(/^\d{10}$/),
});

/**
 * Pre-login check: does this phone number already have a login PIN set?
 * Runs server-side with the service-role client so the underlying
 * has_login_pin RPC never needs to be callable by anonymous browsers.
 */
export const hasLoginPin = createServerFn({ method: "POST" })
  .inputValidator((input) => PhoneSchema.parse(input))
  .handler(async ({ data }): Promise<{ hasPin: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("has_login_pin", {
      p_phone: `+91${data.phone}`,
    });
    if (error) {
      console.error("has_login_pin failed", error);
      return { hasPin: false };
    }
    return { hasPin: result === true };
  });
