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
              onClick={() => void shareReferralInvite(s.banner ?? s.prizes[0]?.photo)}
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

      {s.my && s.my.tickets.length > 0 && (
        <>
          <h3 className="mt-7 text-base font-bold text-foreground">Your Tickets ({s.my.tickets.length})</h3>
          <p className="mt-1 text-xs font-semibold text-primary">Invite a friend, get 1 more ticket</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {s.my.tickets.map((t) => (
              <div key={t.ticketNo} className="rounded-[14px] border border-dashed border-primary/50 bg-primary/5 p-3">
                <p className="text-sm font-extrabold tracking-wide text-foreground">{t.ticketNo}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t.type === "base" ? "Signup" : `Bonus${t.friendName ? ` · ${t.friendName}` : ""}`}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {s.winnersPublished && s.winners.length > 0 && (
        <>
          <h3 className="mt-7 text-base font-bold text-foreground">Winners</h3>
          <div className="mt-3 space-y-2">
            {s.winners.map((w, i) => (
              <div key={i} className="flex items-center gap-3 rounded-[14px] border border-border bg-card p-3">
                <Trophy className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{w.name}</p>
                  {w.ticketNo && <p className="text-xs text-muted-foreground">Ticket {w.ticketNo}</p>}
                </div>
                {w.prize && <span className="text-xs text-muted-foreground">{w.prize}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* OFFER 1 — LUCKY DRAW */}
      <section className="mt-7 rounded-[18px] border-2 border-primary/30 bg-primary/5 p-4">
        <span className="inline-block rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary-foreground">Offer 1</span>
        <h3 className="mt-2 flex items-center gap-2 text-lg font-extrabold text-foreground"><Gift className="h-5 w-5 text-primary" /> Lucky Draw</h3>
        <p className="text-xs text-muted-foreground">Har ticket ek chance — random draw se winners chune jayenge.</p>

        {draw.length > 0 && (
          <>
            <h4 className="mt-4 text-sm font-bold text-foreground">Lucky Draw Prizes</h4>
            <div className="mt-2 grid grid-cols-2 gap-3">
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

        <h4 className="mt-5 text-sm font-bold text-foreground">How it works</h4>
        <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2"><Gift className="h-4 w-4 shrink-0 text-primary" /> Enroll karte hi 1 ticket free milta hai.</li>
          <li className="flex gap-2"><Users className="h-4 w-4 shrink-0 text-primary" /> Har dost ke enroll karne par 1 extra ticket — zyada tickets, zyada chances.</li>
          <li className="flex gap-2"><Trophy className="h-4 w-4 shrink-0 text-primary" /> {s.drawAt ? `${formatLdDate(s.drawAt)} ko` : "Tay date par"} random draw hoga, winners yahin dikhenge.</li>
        </ol>

        <h4 className="mt-5 text-sm font-bold text-foreground">Rules &amp; Terms</h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Entry bilkul free hai.</li>
          <li>Ek mobile number par sirf ek entry.</li>
          <li>Dost tabhi count hoga jab wo app download, login aur enroll kare.</li>
          <li>Prize par tax, agar laage, kanoon ke hisaab se.</li>
          <li>Google is contest ka sponsor nahi hai.</li>
        </ul>
      </section>

      {/* OFFER 2 — LEADERBOARD */}
      {(s.leaderboardRewards && lb.length > 0) || s.showLeaderboard ? (
        <section className="mt-6 rounded-[18px] border-2 border-border bg-card p-4">
          <span className="inline-block rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-background">Offer 2</span>
          <h3 className="mt-2 flex items-center gap-2 text-lg font-extrabold text-foreground"><Trophy className="h-5 w-5 text-primary" /> Referral Leaderboard</h3>
          <p className="text-xs text-muted-foreground">Sabse zyada dost invite karo — top rank par guaranteed inaam.</p>

          {s.leaderboardRewards && lb.length > 0 && (
            <>
              <h4 className="mt-4 text-sm font-bold text-foreground">Leaderboard Prizes</h4>
              <div className="mt-2 space-y-2">
                {lb.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-[14px] border border-border bg-background p-3">
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

          <h4 className="mt-5 text-sm font-bold text-foreground">How it works</h4>
          <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><Users className="h-4 w-4 shrink-0 text-primary" /> Jitne zyada dost enroll karwaoge, utni upar rank.</li>
            <li className="flex gap-2"><Trophy className="h-4 w-4 shrink-0 text-primary" /> Top ranks ko bina draw ke guaranteed prize milega.</li>
            <li className="flex gap-2"><Gift className="h-4 w-4 shrink-0 text-primary" /> Lucky Draw aur Leaderboard dono ke prize ek saath jeet sakte ho.</li>
          </ol>

          <h4 className="mt-5 text-sm font-bold text-foreground">Rules &amp; Terms</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Sirf verified dost (download + login + enroll) count honge.</li>
            <li>Barabar referrals par jisne pehle score kiya, wo upar.</li>
            <li>Contest khatam hone par final leaderboard lock ho jayega.</li>
          </ul>

          {s.showLeaderboard && <Leaderboard s={s} />}
        </section>
      ) : null}
    </div>
  );
}
