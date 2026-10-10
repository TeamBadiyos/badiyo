import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { shareReferralInvite } from "@/lib/luckyDraw";
import { useEnrol, useLuckyDrawStatus } from "./ContestTab";

const POPUP_KEY = "ld_popup_last_shown";

export function ContestHomeBanner({ onOpen }: { onOpen?: () => void }) {
  const { data: s } = useLuckyDrawStatus();
  const { enrol, busy } = useEnrol();
  const [popup, setPopup] = useState(false);

  // Alternate-day popup: once every 2 calendar days, for enrolled and non-enrolled.
  useEffect(() => {
    if (!s) return;
    const day = Math.floor((Date.now() + 5.5 * 3600_000) / 86400_000); // IST day number
    try {
      const last = Number(localStorage.getItem(POPUP_KEY + "_day") ?? "-99");
      if (day - last < 2) return;
      localStorage.setItem(POPUP_KEY + "_day", String(day));
    } catch {
      /* ignore */
    }
    setPopup(true);
  }, [s]);

  if (!s) return null;
  const top = s.prizes.find((p) => p.type !== "leaderboard") ?? s.prizes[0];
  const my = s.my as { entryNo?: string } | null | undefined;

  if (my) {
    if (!popup) return null;
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-foreground/50 p-6" onClick={() => setPopup(false)}>
        <div className="w-full max-w-sm overflow-hidden rounded-[20px] bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
          {(s.banner || top?.photo) && (
            <img src={s.banner ?? top?.photo ?? ""} alt={s.title} className="aspect-[4/3] w-full object-cover" />
          )}
          <div className="p-4 text-center">
            <p className="text-base font-extrabold text-foreground">Aap enrolled hain! 🎉</p>
            {my.entryNo && <p className="mt-1 text-sm font-semibold text-primary">Entry {my.entryNo}</p>}
            <p className="mt-2 text-sm text-muted-foreground">Doston ko invite karein aur jeetne ke mauke badhayein!</p>
            <button
              type="button"
              onClick={() => {
                setPopup(false);
                void shareReferralInvite(s.banner ?? top?.photo);
              }}
              className="mt-4 w-full rounded-[12px] bg-primary py-2.5 text-sm font-bold text-primary-foreground"
            >
              Invite Friends
            </button>
            <button type="button" onClick={() => setPopup(false)} className="mt-2 w-full py-2 text-sm font-semibold text-muted-foreground">
              Later
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            {top ? `Win ${top.name}` : "Enroll free"}
          </p>
        </div>
        {s.my ? (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              void shareReferralInvite(s.banner ?? s.prizes[0]?.photo);
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
