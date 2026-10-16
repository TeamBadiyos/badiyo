import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Guest (signed-out) read of the public contest info only: campaign, prizes,
// enrolled count (if shown) and published winners with masked names.
// The customer RPCs are not executable without a user session, so this
// builds the same public shape server-side. No personal data is returned.
function maskName(full: string | null | undefined): string {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Badiyos user";
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

export const guestLuckyDrawStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: c, error } = await db
    .from("lucky_draw_campaigns")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("[guest contest]", error.message);
    throw new Error("Could not load the contest");
  }
  if (!c) return JSON.stringify(null);
  const [{ count }, { data: prizes }] = await Promise.all([
    db.from("lucky_draw_enrolments").select("id", { count: "exact", head: true }).eq("campaign_id", c.id),
    db
      .from("lucky_draw_prizes")
      .select("id, prize_type, name, photo_url, value_inr, quantity, rank_from, rank_to, sort_no")
      .eq("campaign_id", c.id)
      .order("prize_type")
      .order("sort_no")
      .order("rank_from"),
  ]);
  let winners: unknown = null;
  if (c.winners_published) {
    const { data: w } = await db
      .from("lucky_draw_winners")
      .select("prize_type, rank, ticket_no, prize_id, user_id")
      .eq("campaign_id", c.id);
    const ids = Array.from(new Set((w ?? []).map((x: any) => x.user_id).filter(Boolean)));
    const { data: users } = ids.length
      ? await db.from("users").select("id, full_name").in("id", ids)
      : { data: [] };
    const nameOf = new Map((users ?? []).map((u: any) => [u.id, u.full_name]));
    const prizeOf = new Map((prizes ?? []).map((p: any) => [p.id, p.name]));
    winners = (w ?? []).map((x: any) => ({
      type: x.prize_type,
      rank: x.rank,
      prize: prizeOf.get(x.prize_id) ?? null,
      ticket_no: x.ticket_no,
      name: maskName(nameOf.get(x.user_id) as string | undefined),
    }));
  }
  return JSON.stringify({
    id: c.id,
    title: c.title,
    description: c.description,
    banner_url: c.banner_url,
    start_at: c.start_at,
    end_at: c.end_at,
    enrolment_target: c.enrolment_target,
    enrolled_count: c.show_enrolled_count ? count ?? 0 : null,
    show_leaderboard: c.show_leaderboard,
    referral_bonus_enabled: c.referral_bonus_enabled,
    winners_published: c.winners_published,
    my: null,
    prizes: (prizes ?? []).map((p: any) => ({
      type: p.prize_type,
      name: p.name,
      photo_url: p.photo_url,
      value_inr: p.value_inr,
      quantity: p.quantity,
      rank_from: p.rank_from,
      rank_to: p.rank_to,
    })),
    winners,
  });
});

// Leaderboard needs a signed-in view; guests see an empty list.
export const guestLuckyDrawLeaderboard = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(200) }).parse(d))
  .handler(async () => JSON.stringify([]));
