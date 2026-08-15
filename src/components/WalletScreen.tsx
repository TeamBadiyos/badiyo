import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePullToRefresh, PullToRefreshIndicator } from "@/lib/usePullToRefresh";
import { ArrowLeft, Coins, Wallet as WalletIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type WalletTx = {
  id: string;
  amount: number;
  type: "credit" | "debit";
  description: string;
  created_at: string;
};

async function fetchTransactions(): Promise<WalletTx[]> {
  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("wallet_transactions")
    .select("id, amount, type, description, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WalletTx[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function WalletScreen({ onBack }: { onBack: () => void }) {
  const { data: txs = [], isLoading } = useQuery({
    queryKey: ["wallet_transactions"],
    queryFn: fetchTransactions,
  });

  const queryClient = useQueryClient();
  const { pull, refreshing } = usePullToRefresh(async () => {
    await queryClient.refetchQueries({ queryKey: ["wallet_transactions"] });
  });

  const balance = txs.reduce(
    (sum, t) => sum + (t.type === "credit" ? Number(t.amount) : -Number(t.amount)),
    0,
  );

  return (
    <main className="min-h-screen w-full bg-background pb-10 momentum-scroll">
      <PullToRefreshIndicator pull={pull} refreshing={refreshing} />
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">Wallet</h1>
        </header>

        {/* Balance card */}
        <section className="mt-5 rounded-[18px] bg-primary/10 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary/80">
                Wallet Balance
              </p>
              <p className="mt-2 text-3xl font-extrabold text-foreground">
                Rs {balance}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Badiyos coins can be used on your next booking.
              </p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Coins className="h-6 w-6" />
            </div>
          </div>
        </section>

        {/* Transactions */}
        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">Transaction History</h2>
        </div>

        <section className="mt-3 space-y-2">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : txs.length === 0 ? (
            <EmptyState />
          ) : (
            txs.map((t) => {
              const isCredit = t.type === "credit";
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-[14px] border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {t.description}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(t.created_at)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-bold ${
                      isCredit ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {isCredit ? "+" : "−"} Rs {Number(t.amount)}
                  </span>
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-border bg-card px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <WalletIcon className="h-7 w-7 text-primary" />
      </div>
      <p className="mt-4 text-base font-bold text-foreground">No transactions yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Rewards and refunds will appear here.
      </p>
    </div>
  );
}
