import { useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { ArrowLeft, Coins, Wallet as WalletIcon } from "lucide-react";
import { useLanguage } from "@/i18n";
import { useWalletHistory, useWalletSummary, type WalletHistoryItem } from "@/lib/wallet";

const T = {
  en: {
    title: "Wallet", total: "badiyos Wallet", cash: "Cash", bonus: "Bonus", expires: "expires",
    history: "Transaction History", loading: "Loading…", more: "Load more", empty: "No transactions yet",
    emptySub: "Rewards and refunds will appear here.", note: "Use your wallet on your next booking.",
    kinds: { top_up: "Top-up", payment: "Payment", refund: "Refund", referral: "Referral", bonus: "Bonus", bonus_expired: "Bonus expired", opening_balance: "Opening balance", adjustment: "Adjustment", old_coins: "Old coins" } as Record<string, string>,
  },
  mr: {
    title: "वॉलेट", total: "badiyos वॉलेट", cash: "रोख", bonus: "बोनस", expires: "मुदत",
    history: "व्यवहार इतिहास", loading: "लोड होत आहे…", more: "आणखी पहा", empty: "अजून कोणतेही व्यवहार नाहीत",
    emptySub: "रिवॉर्ड्स आणि परतावे इथे दिसतील.", note: "पुढच्या बुकिंगवर वॉलेट वापरा.",
    kinds: { top_up: "टॉप-अप", payment: "पेमेंट", refund: "परतावा", referral: "रेफरल", bonus: "बोनस", bonus_expired: "बोनसची मुदत संपली", opening_balance: "सुरुवातीची शिल्लक", adjustment: "समायोजन", old_coins: "जुने कॉइन्स" } as Record<string, string>,
  },
};

const fmt = (iso: string, lang: string, year = true) =>
  new Date(iso).toLocaleDateString(lang === "mr" ? "mr-IN" : "en-IN", { day: "2-digit", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "Asia/Kolkata" });
const rupee = (n: number) => `₹${Math.round(n * 100) / 100}`;

export function WalletScreen({ onBack }: { onBack: () => void }) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? T.mr : T.en;
  const { data: sum } = useWalletSummary();
  const hist = useWalletHistory();
  const items: WalletHistoryItem[] = hist.data?.pages.flatMap((p) => p.items) ?? [];
  const qc = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await qc.refetchQueries({ queryKey: ["wallet"] });
  });

  return (
    <main className="min-h-screen w-full bg-background pb-10 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">{s.title}</h1>
        </header>

        <section className="mt-5 rounded-[18px] bg-primary/10 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">{s.total}</p>
              <p className="mt-2 text-4xl font-extrabold text-foreground">{rupee(sum?.balance ?? 0)}</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Coins className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-primary/20 pt-3 text-sm">
            <p className="font-bold text-foreground">{s.cash} {rupee(sum?.cash ?? 0)}</p>
            {(sum?.bonus_expiring ?? []).map((b, i) => (
              <p key={i} className="font-semibold text-foreground">
                {s.bonus} {rupee(b.amount)} <span className="text-muted-foreground">· {s.expires} {fmt(b.expires_at, lang, false)}</span>
              </p>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">{s.note}</p>
          </div>
        </section>

        <h2 className="mt-6 text-base font-bold text-foreground">{s.history}</h2>
        <section className="mt-3 space-y-2">
          {hist.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{s.loading}</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center rounded-[18px] border border-dashed border-border bg-card px-6 py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10"><WalletIcon className="h-7 w-7 text-primary" /></div>
              <p className="mt-4 text-base font-bold text-foreground">{s.empty}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.emptySub}</p>
            </div>
          ) : (
            items.map((t) => {
              const amt = Number(t.amount);
              const isCredit = amt >= 0;
              const kind = s.kinds[t.kind] ?? s.kinds.adjustment;
              return (
                <div key={`${t.legacy ? "o" : "n"}_${t.id}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{kind}</p>
                    {t.label && t.label !== kind && <p className="truncate text-xs text-muted-foreground">{t.label}</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">{fmt(t.created_at, lang)}</p>
                  </div>
                  <span className={`shrink-0 text-sm font-bold ${isCredit ? "text-primary" : "text-muted-foreground"}`}>
                    {isCredit ? "+" : "−"} {rupee(Math.abs(amt))}
                  </span>
                </div>
              );
            })
          )}
          {hist.hasNextPage && (
            <button onClick={() => hist.fetchNextPage()} disabled={hist.isFetchingNextPage} className="w-full rounded-[14px] border border-border bg-card py-3 text-sm font-bold text-primary">
              {hist.isFetchingNextPage ? s.loading : s.more}
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
