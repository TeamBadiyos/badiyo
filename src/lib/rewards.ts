import { supabase } from "@/integrations/supabase/client";

export type RewardLedgerRow = {
  id: string;
  reward_type: string;
  reward_value: number;
  status: string;
  credited_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
  notes: string | null;
  program_id: string;
  program_name: string | null;
};

export type RewardProgramRow = {
  id: string;
  name: string;
  trigger_type: string;
  condition: Record<string, unknown>;
  reward_type: string;
  reward_value: number;
  valid_until: string | null;
  /** Countable progress, when the trigger supports it. */
  progress?: { current: number; total: number } | null;
};

export type RewardsSnapshot = {
  ledger: RewardLedgerRow[];
  programs: RewardProgramRow[];
  /** Sum of active (non-reversed) coin rewards from the rewards engine. */
  coinsFromRewards: number;
  /** Legacy referral coins stored on the user row. */
  legacyReferralCoins: number;
  totals: Array<{ type: string; value: number }>;
};

const EMPTY: RewardsSnapshot = {
  ledger: [],
  programs: [],
  coinsFromRewards: 0,
  legacyReferralCoins: 0,
  totals: [],
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchCustomerRewards(): Promise<RewardsSnapshot> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return EMPTY;

  const [ledgerRes, programsRes, userRes2] = await Promise.all([
    supabase
      .from("reward_ledger")
      .select(
        "id, reward_type, reward_value, status, credited_at, reversed_at, reversal_reason, notes, program_id, reward_programs(name)",
      )
      .eq("actor_type", "customer")
      .eq("actor_id", uid)
      .order("credited_at", { ascending: false })
      .limit(100),
    supabase
      .from("reward_programs")
      .select("id, name, trigger_type, condition, reward_type, reward_value, valid_from, valid_until")
      .eq("actor_type", "customer")
      .eq("is_active", true),
    supabase
      .from("users")
      .select("total_coins_earned, referral_count, successful_referrals")
      .eq("id", uid)
      .maybeSingle(),
  ]);

  if (ledgerRes.error) console.error("reward_ledger fetch failed:", ledgerRes.error);
  if (programsRes.error) console.error("reward_programs fetch failed:", programsRes.error);

  const ledger: RewardLedgerRow[] = (ledgerRes.data ?? []).map((r) => {
    const program = (r as unknown as { reward_programs?: { name?: string } | null }).reward_programs;
    return {
      id: r.id,
      reward_type: r.reward_type,
      reward_value: num(r.reward_value),
      status: r.status,
      credited_at: r.credited_at,
      reversed_at: r.reversed_at,
      reversal_reason: r.reversal_reason,
      notes: r.notes,
      program_id: r.program_id,
      program_name: program?.name ?? null,
    };
  });

  const now = Date.now();
  const referralsDone = num(userRes2.data?.successful_referrals);
  const signupsDone = num(userRes2.data?.referral_count);

  const programs: RewardProgramRow[] = (programsRes.data ?? [])
    .filter((p) => {
      const from = p.valid_from ? Date.parse(p.valid_from) : null;
      const until = p.valid_until ? Date.parse(p.valid_until) : null;
      if (from && now < from) return false;
      if (until && now > until) return false;
      return true;
    })
    .map((p) => {
      const cond = (p.condition ?? {}) as Record<string, unknown>;
      let progress: { current: number; total: number } | null = null;
      if (p.trigger_type === "referral_first_booking") {
        const total = num(cond.referral_count) || 1;
        progress = { current: Math.min(referralsDone, total), total };
      } else if (p.trigger_type === "referral_signup") {
        const total = num(cond.referral_count) || 1;
        progress = { current: Math.min(signupsDone, total), total };
      } else if (p.trigger_type === "count_threshold") {
        const total = num(cond.count) || 1;
        progress = { current: 0, total };
      }
      return {
        id: p.id,
        name: p.name,
        trigger_type: p.trigger_type,
        condition: cond,
        reward_type: p.reward_type,
        reward_value: num(p.reward_value),
        valid_until: p.valid_until,
        progress,
      };
    });

  const active = ledger.filter((l) => l.status !== "reversed");
  const totalsMap = new Map<string, number>();
  for (const l of active) totalsMap.set(l.reward_type, (totalsMap.get(l.reward_type) ?? 0) + l.reward_value);

  return {
    ledger,
    programs,
    coinsFromRewards: totalsMap.get("coins") ?? 0,
    legacyReferralCoins: num(userRes2.data?.total_coins_earned),
    totals: Array.from(totalsMap, ([type, value]) => ({ type, value })),
  };
}

export function formatRewardValue(type: string, value: number): string {
  if (type === "coins") return `${value} coins`;
  if (type === "cash" || type === "wallet_credit") return `Rs ${value}`;
  if (type === "discount_percent") return `${value}% off`;
  if (type === "free_booking") return "Free booking";
  return `${value} ${type.replace(/_/g, " ")}`;
}
