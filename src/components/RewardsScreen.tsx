import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { Coins, Gift, Star, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "./BottomNav";

async function fetchTotalCoins(): Promise<number> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return 0;
  const { data, error } = await supabase
    .from("users")
    .select("total_coins_earned")
    .eq("id", uid)
    .single();
  if (error) {
    console.error("fetchTotalCoins error:", error);
    return 0;
  }
  return Number(data?.total_coins_earned ?? 0);
}

type MissionAction = "bookings" | "refer" | "rate";

const MISSIONS: Array<{
  id: MissionAction;
  title: string;
  description: string;
  icon: typeof Trophy;
  reward: number;
  progress?: { current: number; total: number };
  cta: string;
}> = [
  {
    id: "bookings",
    title: "Complete 3 bookings this month",
    description: "Book cleanings and earn coins on every milestone.",
    icon: Trophy,
    reward: 50,
    progress: { current: 1, total: 3 },
    cta: "Book now",
  },
  {
    id: "refer",
    title: "Refer a friend",
    description: "Invite a friend to badiyos and earn when they book.",
    icon: Gift,
    reward: 100,
    cta: "Invite",
  },
  {
    id: "rate",
    title: "Rate your last 5 services",
    description: "Share feedback and unlock bonus coins.",
    icon: Star,
    reward: 20,
    cta: "Rate",
  },
];

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

  const { data: coins = 0, isLoading } = useQuery({
    queryKey: ["users_total_coins"],
    queryFn: fetchTotalCoins,
  });

  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await queryClient.refetchQueries({ queryKey: ["users_total_coins"] });
  });

  function handleMissionClick(id: MissionAction) {
    if (id === "refer") return onOpenReferrals();
    if (id === "rate") return onOpenBookings();
    return onOpenHome();
  }


  return (
    <main className="min-h-screen w-full bg-background pb-28 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <h1 className="text-lg font-bold text-foreground">Rewards & Missions</h1>

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
                Keep earning by completing missions.
              </p>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Coins className="h-7 w-7" />
            </div>
          </div>
        </section>

        {/* Missions */}
        <h2 className="mt-8 text-base font-bold text-foreground">Missions</h2>
        <div className="mt-4 space-y-3">
          {MISSIONS.map((m) => {
            const Icon = m.icon;
            const pct = m.progress ? Math.round((m.progress.current / m.progress.total) * 100) : 0;
            return (
              <button
                type="button"
                key={m.id}
                onClick={() => handleMissionClick(m.id)}
                aria-label={m.title}
                className="flex w-full items-start gap-3 rounded-[18px] border border-border bg-card p-4 text-left shadow-sm transition active:scale-[0.98] active:bg-muted/60"
              >

                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-foreground">{m.title}</p>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
                      +{m.reward} coins
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                  {m.progress && (
                    <div className="mt-3">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        {m.progress.current}/{m.progress.total} completed
                      </p>
                    </div>
                  )}
                </div>
              </button>
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
