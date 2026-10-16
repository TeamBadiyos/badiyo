import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Guest (signed-out) read of the public contest info. The status/leaderboard
// RPCs only return the caller's own data via auth.uid(), which is null here,
// so nothing personal is exposed; names are already masked by the RPCs.
export const guestLuckyDrawStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("customer_lucky_draw_status");
  if (error) throw new Error("Could not load the contest");
  return (data ?? null) as unknown;
});

export const guestLuckyDrawLeaderboard = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("customer_lucky_draw_leaderboard", {
      _limit: data.limit,
    });
    if (error) throw new Error("Could not load the leaderboard");
    return (rows ?? null) as unknown;
  });
