import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { Coins, Gift, Sparkles } from "lucide-react";
import { fetchCustomerRewards, formatRewardValue } from "@/lib/rewards";
import { ContestTab } from "./contest/ContestTab";
import { DealsTab, useDeals } from "./deals/DealsTab";
import { BottomNav } from "./BottomNav";
import { useLanguage } from "@/i18n";
import { fetchCourierEnabled } from "./courier/courierData";

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
  initialTab = "contest",
  onOpenHome,
  onOpenRewards,
  onOpenReferrals,
  onOpenBookings,
  onOpenCourier,
  focusDealId,
}: {
  initialTab?: "rewards" | "contest" | "deals";
  focusDealId?: string | null;
  onOpenHome: () => void;
  onOpenRewards: () => void;
  onOpenReferrals: () => void;
  onOpenBookings: () => void;
  onOpenCourier?: () => void;
}) {
    const { lang: __lang } = useLanguage();
  const tr = (en: string, mr: string) => (__lang === "mr" ? mr : en);
  const { data: courierEnabled = false } = useQuery({
    queryKey: ["courier_enabled"],
    queryFn: () => fetchCourierEnabled(),
    staleTime: 5 * 60_000,
  });
  const [tab, setTab] = useState<"rewards" | "contest" | "deals">(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const { offers: dealOffers } = useDeals();
  const dealsLive = (dealOffers.data ?? []).length > 0;
  const { data, isLoading } = useQuery({
    queryKey: ["customer_rewards"],
    queryFn: fetchCustomerRewards,
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["customer_rewards"] }),
      queryClient.refetchQueries({ queryKey: ["my_coupons"] }),
      queryClient.refetchQueries({ queryKey: ["campaign_offers"] }),
      queryClient.refetchQueries({ queryKey: ["lucky_draw_status"] }),
    ]);
  });

  const ledger = data?.ledger ?? [];
  const programs = data?.programs ?? [];
  const coins = data?.legacyReferralCoins ?? 0;
  const otherTotals = (data?.totals ?? []).filter((t) => t.type !== "coins");

  return (
    <main className="min-h-screen w-full bg-background pb-nav momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <h1 className="text-lg font-bold text-foreground">{tr("Rewards", "रिवॉर्ड्स")}</h1>

        {/* Tabs */}
        <div className="mt-4 flex rounded-[14px] border border-border bg-card p-1">
          {(["rewards", "contest", "deals"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`relative flex-1 rounded-[11px] py-2 text-sm font-bold capitalize transition ${
                tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {k === "rewards" ? tr("Rewards", "रिवॉर्ड्स") : k === "contest" ? tr("Contest", "स्पर्धा") : tr("Deals", "डील्स")}
              {k === "deals" && dealsLive && <span className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-destructive" />}
            </button>
          ))}
        </div>

        {tab === "contest" && <ContestTab />}
        {tab === "deals" && <DealsTab focusId={focusDealId} />}

        {tab === "rewards" && (
          <>
        {/* Referral first */}
        <h2 className="mt-6 text-base font-bold text-foreground">{tr("Refer & Earn", "रेफर करा आणि कमवा")}</h2>
        <button
          type="button"
          onClick={onOpenReferrals}
          className="mt-3 flex w-full items-start gap-3 rounded-[18px] border border-border bg-primary/5 p-4 text-left shadow-sm transition active:scale-[0.98]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Gift className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">{tr("Invite friends, earn badiyos Wallet money", "मित्रांना बोलवा, badiyos वॉलेटमध्ये पैसे मिळवा")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tr("Share your code and get money in your badiyos Wallet when a friend joins, plus more once they complete their first booking.", "तुमचा कोड शेअर करा — मित्र जॉइन झाल्यावर badiyos वॉलेटमध्ये पैसे मिळवा, आणि त्यांच्या पहिल्या बुकिंगनंतर आणखी.")}
            </p>
            <span className="mt-2 inline-block text-xs font-bold text-primary">
              {tr("Share your code →", "तुमचा कोड शेअर करा →")}
            </span>
          </div>
        </button>

        {/* Summary card */}
        <section className="mt-6 rounded-[18px] bg-primary/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">
                {tr("Total earned in badiyos Wallet", "badiyos वॉलेटमध्ये एकूण कमाई")}
              </p>
              <p className="mt-2 text-3xl font-extrabold text-foreground">
                ₹{isLoading ? "—" : coins}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr("Added to your badiyos Wallet", "तुमच्या badiyos वॉलेटमध्ये जमा")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tr("Includes referral rewards and bonuses credited to you.", "रेफरल रिवॉर्ड्स आणि तुम्हाला मिळालेले बोनस यांचा समावेश.")}
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
        <h2 className="mt-8 text-base font-bold text-foreground">{tr("Ways to earn", "कमावण्याचे मार्ग")}</h2>
        <div className="mt-4 space-y-3">
          {isLoading && (
            <p className="text-sm text-muted-foreground">{tr("Loading…", "लोड होत आहे…")}</p>
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
                      {tr("Valid till", "पर्यंत वैध:")} {formatDate(p.valid_until)}
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
                        {p.progress.current}/{p.progress.total} {tr("completed", "पूर्ण")}
                      </p>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* History */}
        <h2 className="mt-8 text-base font-bold text-foreground">{tr("Reward history", "रिवॉर्ड इतिहास")}</h2>
        <div className="mt-4 space-y-3">
          {!isLoading && ledger.length === 0 && (
            <p className="rounded-[18px] border border-border bg-card p-4 text-xs text-muted-foreground">
              {tr("No rewards yet. Complete bookings and refer friends to start earning.", "अजून रिवॉर्ड्स नाहीत. कमाई सुरू करण्यासाठी बुकिंग पूर्ण करा आणि मित्रांना रेफर करा.")}
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
                      {l.program_name ?? tr("Reward", "रिवॉर्ड")}
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
                        {tr("Reversed", "परत घेतले")}
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
          </>
        )}
      </div>


      <BottomNav
        activeKey={"rewards"}
        onHome={() => onOpenHome()}
        onRewards={onOpenRewards}
        onParcel={courierEnabled ? onOpenCourier : undefined}
      />
    </main>
  );
}
