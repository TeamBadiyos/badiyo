import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { Coins, Gift, Sparkles } from "lucide-react";
import { fetchCustomerRewards, formatRewardValue } from "@/lib/rewards";
import { BottomNav } from "./BottomNav";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function RewardsScreen({
  onOpenHome,
  onOpenRewards,
  onOpenReferrals,
  onOpenBookings,
}: {
  onOpenHome: () => void;
  onOpenRewards: () => void;
  onOpenReferrals: () => void;
  onOpenBookings: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer_rewards"],
    queryFn: fetchCustomerRewards,
    staleTime: 0,
  });

  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await queryClient.refetchQueries({ queryKey: ["customer_rewards"] });
  });

  const ledger = data?.ledger ?? [];
  const programs = data?.programs ?? [];
  const coins = data?.legacyReferralCoins ?? 0;
  const otherTotals = (data?.totals ?? []).filter((t) => t.type !== "coins" && t.type !== "cash");

  return (
    <main className="min-h-screen w-full bg-background pb-28 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <h1 className="text-lg font-bold text-foreground">Rewards</h1>

        {/* Summary card */}
        <section className="mt-5 rounded-[18px] bg-primary/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">
                Total Coins Earned
              </p>
              <p className="mt-2 text-3xl font-extrabold text-foreground">
                {isLoading ? "—" : coins}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Includes referral coins and rewards credited to you.
              </p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Coins className="h-7 w-7" />
            </div>
          </div>
          {otherTotals.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {otherTotals.map((t) => (
                <span
                  key={t.type}
                  className="rounded-full bg-card px-3 py-1 text-xs font-bold text-foreground"
                >
                  {formatRewardValue(t.type, t.value)}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Active offers */}
        <h2 className="mt-8 text-base font-bold text-foreground">Ways to earn</h2>
        <div className="mt-4 space-y-3">
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {!isLoading && programs.length === 0 && (
            <button
              type="button"
              onClick={onOpenReferrals}
              className="flex w-full items-start gap-3 rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:scale-[0.98]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Gift className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">Refer a friend</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  No offers running right now — invite friends and earn coins when they book.
                </p>
              </div>
            </button>
          )}
          {programs.map((p) => {
            const pct = p.progress
              ? Math.round((p.progress.current / Math.max(p.progress.total, 1)) * 100)
              : 0;
            const isReferral = p.trigger_type.startsWith("referral");
            return (
              <button
                type="button"
                key={p.id}
                onClick={isReferral ? onOpenReferrals : onOpenHome}
                aria-label={p.name}
                className="flex w-full items-start gap-3 rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:scale-[0.98] active:bg-muted/60"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  {isReferral ? (
                    <Gift className="h-5 w-5 text-primary" />
                  ) : (
                    <Sparkles className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-foreground">{p.name}</p>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                      {formatRewardValue(p.reward_type, p.reward_value)}
                    </span>
                  </div>
                  {p.valid_until && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Valid till {formatDate(p.valid_until)}
                    </p>
                  )}
                  {p.progress && p.progress.total > 1 && (
                    <div className="mt-3">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        {p.progress.current}/{p.progress.total} completed
                      </p>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* History */}
        <h2 className="mt-8 text-base font-bold text-foreground">Reward history</h2>
        <div className="mt-4 space-y-3">
          {!isLoading && ledger.length === 0 && (
            <p className="rounded-[18px] border border-border bg-card p-4 text-xs text-muted-foreground">
              No rewards yet. Complete bookings and refer friends to start earning.
            </p>
          )}
          {ledger.map((l) => {
            const reversed = l.status === "reversed";
            return (
              <div
                key={l.id}
                className="rounded-[18px] border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className={`truncate text-sm font-bold ${reversed ? "text-muted-foreground line-through" : "text-foreground"}`}
                    >
                      {l.program_name ?? "Reward"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(l.credited_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold ${reversed ? "bg-muted text-muted-foreground line-through" : "bg-primary/10 text-primary"}`}
                    >
                      +{formatRewardValue(l.reward_type, l.reward_value)}
                    </span>
                    {reversed && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive">
                        Reversed
                      </span>
                    )}
                  </div>
                </div>
                {reversed && l.reversal_reason && (
                  <p className="mt-2 text-xs text-muted-foreground">{l.reversal_reason}</p>
                )}
                {!reversed && l.notes && (
                  <p className="mt-2 text-xs text-muted-foreground">{l.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <BottomNav
        activeKey="rewards"
        onHome={onOpenHome}
        onOrders={onOpenBookings}
        onRewards={onOpenRewards}
      />
    </main>
  );
}
