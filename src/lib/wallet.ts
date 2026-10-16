import { useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";

export type WalletSummary = {
  balance: number;
  cash: number;
  bonus: number;
  bonus_note: string | null;
  bonus_expiring: { amount: number; expires_at: string }[];
};

export type WalletHistoryItem = {
  id: string;
  created_at: string;
  amount: number;
  bucket: string | null;
  kind: string;
  label: string | null;
  expires_at: string | null;
  legacy: boolean;
};

const EMPTY: WalletSummary = { balance: 0, cash: 0, bonus: 0, bonus_note: null, bonus_expiring: [] };

export async function fetchWalletSummary(): Promise<WalletSummary> {
  const { data: u } = await getAuthUser();
  if (!u.user) return EMPTY;
  const { data, error } = await supabase.rpc("app_wallet_summary" as never);
  if (error || !data) return EMPTY;
  const d = data as Record<string, unknown>;
  const exp = Array.isArray(d.bonus_expiring) ? (d.bonus_expiring as { amount: number; expires_at: string }[]) : [];
  return {
    balance: Number(d.balance) || 0,
    cash: Number(d.cash) || 0,
    bonus: Number(d.bonus) || 0,
    bonus_note: (d.bonus_note as string) ?? null,
    bonus_expiring: exp
      .map((e) => ({ amount: Number(e.amount) || 0, expires_at: e.expires_at }))
      .filter((e) => e.amount > 0)
      .sort((a, b) => a.expires_at.localeCompare(b.expires_at)),
  };
}

export function useWalletSummary() {
  return useQuery({ queryKey: ["wallet", "summary"], queryFn: fetchWalletSummary, staleTime: 30_000 });
}

export function useWalletHistory() {
  return useInfiniteQuery({
    queryKey: ["wallet", "history"],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data: u } = await getAuthUser();
      if (!u.user) return { items: [] as WalletHistoryItem[], next_before: null as string | null };
      const { data, error } = await supabase.rpc("app_wallet_history" as never, { _limit: 30, _before: pageParam } as never);
      if (error) throw error;
      const d = (data ?? {}) as { items?: WalletHistoryItem[]; next_before?: string | null };
      return { items: d.items ?? [], next_before: d.next_before ?? null };
    },
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
}

/** Refresh every wallet figure (header, checkout, wallet page, referral). */
export function invalidateWallet(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["wallet"] });
  void qc.invalidateQueries({ queryKey: ["my_coin_balance"] });
  void qc.invalidateQueries({ queryKey: ["wallet_transactions"] });
}
