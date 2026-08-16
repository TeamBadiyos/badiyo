// Public pre-login check: does this phone already have a login PIN set?
// Raw HTTP route (not a server fn) so the Capacitor native shell can call it
// with an absolute URL. It runs server-side with the service-role client, so
// the has_login_pin RPC stays inaccessible to anonymous browsers.
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/has-login-pin")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { headers: CORS }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { phone?: string };
          const digits = String(body.phone ?? "").replace(/\D/g, "").slice(-10);
          if (digits.length !== 10) return json({ hasPin: false, error: "Invalid phone" }, 400);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("has_login_pin", {
            p_phone: `+91${digits}`,
          });
          if (error) {
            console.error("has_login_pin failed", error);
            return json({ hasPin: false });
          }
          return json({ hasPin: data === true });
        } catch (err) {
          console.error("has-login-pin route error", err);
          return json({ hasPin: false });
        }
      },
    },
  },
});
