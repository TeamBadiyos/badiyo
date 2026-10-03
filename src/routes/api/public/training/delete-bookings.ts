import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, readBody, requireStaff, str } from "@/lib/trainingAdmin.server";

// delete_training_bookings — super_admin only.
// Body: { booking_ids?: string[], from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', expert_id?: string }
export const Route = createFileRoute("/api/public/training/delete-bookings")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const auth = await requireStaff(request, ["super_admin"]);
        if ("error" in auth) return auth.error;
        const body = await readBody(request);
        const ids = Array.isArray(body.booking_ids)
          ? body.booking_ids.filter((x): x is string => typeof x === "string")
          : [];
        const { data, error } = await auth.supabase.rpc("training_delete_bookings" as never, {
          _actor: auth.uid,
          _ids: ids.length ? ids : null,
          _from: str(body.from),
          _to: str(body.to),
          _expert_id: str(body.expert_id),
        } as never);
        if (error) return json({ error: error.message }, 400);
        return json(data);
      },
    },
  },
});
