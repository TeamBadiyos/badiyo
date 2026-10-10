import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { shareReferralInvite } from "@/lib/luckyDraw";
import { useEnrol, useLuckyDrawStatus } from "./ContestTab";

const POPUP_KEY = "ld_popup_last_shown";

export function ContestHomeBanner({ onOpen }: { onOpen?: () => void }) {
  const { data: s } = useLuckyDrawStatus();
  const { enrol, busy } = useEnrol();
  const [popup, setPopup] = useState(false);

  useEffect(() => {
    if (!s || s.my) return;
    const today = new Date().toDateString();
    try {
      if (localStorage.getItem(POPUP_KEY) === today) return;
      localStorage.setItem(POPUP_KEY, today);
    } catch {
      /* ignore */
    }
    setPopup(true);
  }, [s]);

  useEffect(() => {
    if (s?.my) setPopup(false);
  }, [s?.my]);

  if (!s) return null;
  const top = s.prizes.find((p) => p.type !== "leaderboard") ?? s.prizes[0];

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 flex w-full items-center gap-3 rounded-[16px] border border-primary/30 bg-primary/10 p-3 text-left active:scale-[0.98]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Trophy className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{s.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {s.my ? `You are enrolled - Entry ${s.my.entryNo}` : top ? `Win ${top.name}` : "Enroll free"}
          </p>
        </div>
        {s.my ? (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              void shareReferralInvite();
            }}
            className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
          >
            Invite Friends
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
            Enroll Free
          </span>
        )}
      </button>

      {popup && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/50 p-6" onClick={() => setPopup(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-[20px] bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            {(top?.photo || s.banner) && (
              <img src={top?.photo ?? s.banner ?? ""} alt={top?.name ?? s.title} className="aspect-[4/3] w-full object-cover" />
            )}
            <div className="p-4 text-center">
              <p className="text-base font-extrabold text-foreground">{s.title}</p>
              {top && <p className="mt-1 text-sm text-primary">Win {top.name}</p>}
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  await enrol();
                  setPopup(false);
                  onOpen?.();
                }}
                className="mt-4 w-full rounded-[12px] bg-primary py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                Enroll Now - Free
              </button>
              <button type="button" onClick={() => setPopup(false)} className="mt-2 w-full py-2 text-sm font-semibold text-muted-foreground">
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
