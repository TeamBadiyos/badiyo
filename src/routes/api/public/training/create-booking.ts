import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, readBody, requireStaff, str } from "@/lib/trainingAdmin.server";

// create_training_booking — super_admin / ops_manager only.
// Body: { price_option_id, scheduled_date?, scheduled_time_slot?, address?, expert_id? }
export const Route = createFileRoute("/api/public/training/create-booking")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const auth = await requireStaff(request, ["super_admin", "ops_manager"]);
        if ("error" in auth) return auth.error;
        const body = await readBody(request);
        const priceOptionId = str(body.price_option_id) ?? str(body.service_id) ?? str(body.item_id);
        if (!priceOptionId) return json({ error: "price_option_id (service) is required" }, 400);
        const address = body.address && typeof body.address === "object" ? body.address : null;
        const { data, error } = await auth.supabase.rpc("training_create_booking" as never, {
          _actor: auth.uid,
          _price_option_id: priceOptionId,
          _scheduled_date: str(body.scheduled_date),
          _scheduled_time_slot: str(body.scheduled_time_slot),
          _address: address,
          _expert_id: str(body.expert_id),
        } as never);
        if (error) return json({ error: error.message }, 400);
        return json({ booking: data });
      },
    },
  },
});
