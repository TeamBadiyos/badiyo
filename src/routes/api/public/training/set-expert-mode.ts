import { createFileRoute } from "@tanstack/react-router";
import { json, preflight, readBody, requireStaff, str } from "@/lib/trainingAdmin.server";

// set_expert_mode — super_admin only. Body: { expert_id, mode: 'TRAINING' | 'LIVE' }
export const Route = createFileRoute("/api/public/training/set-expert-mode")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => {
        const auth = await requireStaff(request, ["super_admin"]);
        if ("error" in auth) return auth.error;
        const body = await readBody(request);
        const expertId = str(body.expert_id);
        const mode = String(body.mode ?? "").toUpperCase();
        if (!expertId || !["TRAINING", "LIVE"].includes(mode)) {
          return json({ error: "expert_id and mode (TRAINING or LIVE) are required" }, 400);
        }
        const { data, error } = await auth.supabase.rpc("training_set_expert_mode" as never, {
          _actor: auth.uid,
          _expert_id: expertId,
          _mode: mode,
        } as never);
        if (error) return json({ error: error.message }, 400);
        return json({ expert: data });
      },
    },
  },
});
