import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Gift, Users, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import {
  LD_STATUS_KEY,
  enrolLuckyDraw,
  fetchLeaderboard,
  fetchLuckyDrawStatus,
  formatLdDate,
  luckyDrawErrorMessage,
  shareReferralInvite,
  type LdStatus,
} from "@/lib/luckyDraw";

export function useLuckyDrawStatus() {
  return useQuery({ queryKey: LD_STATUS_KEY, queryFn: fetchLuckyDrawStatus, staleTime: 60_000 });
}

export function useEnrol() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const enrol = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const no = await enrolLuckyDraw();
      toast.success(no ? `You are enrolled - Entry ${no}` : "You are enrolled!");
    } catch (e) {
      toast.error(luckyDrawErrorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: LD_STATUS_KEY });
      qc.invalidateQueries({ queryKey: ["lucky_draw_lb"] });
    }
  };
  return { enrol, busy };
}

function TopCard({ s }: { s: LdStatus }) {
  const { enrol, busy } = useEnrol();
  const top = s.prizes.find((p) => p.type !== "leaderboard") ?? s.prizes[0];
  return (
    <section className="mt-5 overflow-hidden rounded-[18px] border border-border bg-card shadow-sm">
      {s.banner && <img src={s.banner} alt={s.title} className="aspect-[16/9] w-full object-cover" />}
      <div className="p-4">
        <h2 className="text-base font-bold text-foreground">{s.title}</h2>
        {top && <p className="mt-1 text-sm font-semibold text-primary">Top prize: {top.name}</p>}
        {s.drawAt && <p className="mt-0.5 text-xs text-muted-foreground">Draw on {formatLdDate(s.drawAt)}</p>}
        {s.showEnrolledCount && s.enrolledCount !== null && (
          <p className="mt-0.5 text-xs text-muted-foreground">{s.enrolledCount} enrolled</p>
        )}
        {s.my ? (
          <div className="mt-3 rounded-[14px] bg-primary/10 p-3">
            <p className="text-sm font-bold text-foreground">You are enrolled - Entry {s.my.entryNo}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Total entries: {s.my.entries}</p>
            <button
              type="button"
              onClick={() => void shareReferralInvite()}
              className="mt-3 w-full rounded-[12px] bg-primary py-2.5 text-sm font-bold text-primary-foreground active:scale-[0.98]"
            >
              Invite Friends
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={enrol}
            className="mt-3 w-full rounded-[12px] bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60 active:scale-[0.98]"
          >
            {busy ? "Enrolling…" : "Enroll Now - Free"}
          </button>
        )}
      </div>
    </section>
  );
}

function Leaderboard({ s }: { s: LdStatus }) {
  const [limit, setLimit] = useState(20);
  const { data, isFetching } = useQuery({
    queryKey: ["lucky_draw_lb", s.id, limit],
    queryFn: () => fetchLeaderboard(limit),
    placeholderData: (p) => p,
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !data?.hasMore) return;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && !isFetching) setLimit((l) => l + 20);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [data?.hasMore, isFetching]);
  const rows = data?.rows ?? [];
  const me = data?.me;
  return (
    <>
      <h3 className="mt-7 text-base font-bold text-foreground">Leaderboard</h3>
      <div className="mt-3 space-y-2">
        {rows.length === 0 && !isFetching && (
          <p className="text-xs text-muted-foreground">No entries yet.</p>
        )}
        {rows.map((r) => {
          const top = s.topRanks > 0 && r.rank <= s.topRanks;
          return (
            <div
              key={`${r.rank}-${r.name}`}
              className={`flex items-center gap-3 rounded-[14px] border p-3 ${top ? "border-primary/40 bg-primary/10" : "border-border bg-card"} ${r.isMe ? "ring-2 ring-primary" : ""}`}
            >
              <span className="w-8 text-center text-sm font-extrabold text-foreground">#{r.rank}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {r.isMe ? "You" : r.name}
              </span>
              <span className="text-xs text-muted-foreground">{r.referrals} referrals</span>
            </div>
          );
        })}
        <div ref={sentinel} />
        {isFetching && <p className="text-center text-xs text-muted-foreground">Loading…</p>}
      </div>
      {me && (
        <div className="sticky bottom-24 mt-3 flex items-center gap-3 rounded-[14px] border border-primary bg-card p-3 shadow-md">
          <span className="w-8 text-center text-sm font-extrabold text-primary">#{me.rank}</span>
          <span className="flex-1 text-sm font-bold text-foreground">Your rank</span>
          <span className="text-xs text-muted-foreground">{me.referrals} referrals</span>
        </div>
      )}
    </>
  );
}

export function ContestTab() {
  const { data: s, isLoading, isError, refetch } = useLuckyDrawStatus();
  if (isLoading) return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;
  if (isError)
    return (
      <div className="mt-6 rounded-[18px] border border-border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">Network problem. Please check your internet and try again.</p>
        <button type="button" onClick={() => refetch()} className="mt-2 text-sm font-bold text-primary">
          Retry
        </button>
      </div>
    );
  if (!s)
    return (
      <div className="mt-10 flex flex-col items-center text-center">
        <Trophy className="h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm font-semibold text-muted-foreground">No contest right now. Stay tuned!</p>
      </div>
    );

  const draw = s.prizes.filter((p) => p.type !== "leaderboard");
  const lb = s.prizes.filter((p) => p.type === "leaderboard");

  return (
    <div>
      {s.winnersPublished && s.my?.won && (
        <div className="mt-5 flex items-center gap-3 rounded-[18px] bg-primary p-4 text-primary-foreground">
          <PartyPopper className="h-7 w-7 shrink-0" />
          <div>
            <p className="text-base font-extrabold">You won!</p>
            {s.my.wonPrize && <p className="text-xs opacity-90">{s.my.wonPrize}</p>}
          </div>
        </div>
      )}

      <TopCard s={s} />

      {s.winnersPublished && s.winners.length > 0 && (
        <>
          <h3 className="mt-7 text-base font-bold text-foreground">Winners</h3>
          <div className="mt-3 space-y-2">
            {s.winners.map((w, i) => (
              <div key={i} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3">
                <Trophy className="h-4 w-4 text-primary" />
                <span className="flex-1 text-sm font-semibold text-foreground">{w.name}</span>
                {w.prize && <span className="text-xs text-muted-foreground">{w.prize}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {draw.length > 0 && (
        <>
          <h3 className="mt-7 text-base font-bold text-foreground">Lucky Draw Prizes</h3>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {draw.map((p) => (
              <div key={p.id} className="overflow-hidden rounded-[14px] border border-border bg-card">
                {p.photo ? (
                  <img src={p.photo} alt={p.name} loading="lazy" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-muted">
                    <Gift className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="p-2.5">
                  <p className="line-clamp-2 text-sm font-bold text-foreground">{p.name}</p>
                  {p.value !== null && <p className="text-xs font-semibold text-primary">Worth Rs {p.value}</p>}
                  {p.quantity !== null && <p className="text-xs text-muted-foreground">Qty: {p.quantity}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {s.leaderboardRewards && lb.length > 0 && (
        <>
          <h3 className="mt-7 text-base font-bold text-foreground">Leaderboard Prizes</h3>
          <div className="mt-3 space-y-2">
            {lb.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3">
                {p.photo ? (
                  <img src={p.photo} alt={p.name} loading="lazy" className="h-12 w-12 rounded-[10px] object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-muted">
                    <Gift className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-primary">
                    Rank {p.rankFrom ?? "?"}
                    {p.rankTo && p.rankTo !== p.rankFrom ? ` - ${p.rankTo}` : ""}
                  </p>
                  <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                  {(p.value !== null || (p.quantity ?? 0) > 1) && (
                    <p className="text-xs text-muted-foreground">
                      {p.value !== null ? `Worth Rs ${p.value}` : ""}
                      {(p.quantity ?? 0) > 1 ? ` · ${p.quantity} winners` : ""}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {s.showLeaderboard && <Leaderboard s={s} />}

      <h3 className="mt-7 text-base font-bold text-foreground">How it works</h3>
      <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
        <li className="flex gap-2"><Gift className="h-4 w-4 shrink-0 text-primary" /> Enroll for free with one tap.</li>
        <li className="flex gap-2"><Users className="h-4 w-4 shrink-0 text-primary" /> Invite friends to get more entries and climb the leaderboard.</li>
        <li className="flex gap-2"><Trophy className="h-4 w-4 shrink-0 text-primary" /> Winners are announced here after the draw.</li>
      </ol>

      <h3 className="mt-7 text-base font-bold text-foreground">Terms &amp; Conditions</h3>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Entry is completely free.</li>
        <li>Only one entry per mobile number.</li>
        <li>A friend counts only after they download the app, log in and enroll.</li>
        <li>Taxes on prizes, if any, apply as per law.</li>
        <li>Google is not a sponsor of this contest.</li>
      </ul>
    </div>
  );
}
