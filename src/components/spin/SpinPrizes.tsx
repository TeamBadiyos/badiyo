import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useLanguage } from "@/i18n";
import { fetchMySpinPrizes, redeemSpinPrize, undoSpinPrize, type MySpinPrize } from "@/lib/spin";
import { LiveClock, SwipeSlider, useNow } from "@/components/deals/DealsTab";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null;

function Qr({ code }: { code: string }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(code)}`;
  return (
    <div className="flex flex-col items-center">
      <div className="rounded-2xl border border-border bg-white p-3">
        <img src={src} alt="Prize QR code" width={180} height={180} />
      </div>
      <p className="mt-2 font-mono text-2xl font-black tracking-[0.3em] text-foreground">{code}</p>
    </div>
  );
}

export function SpinPrizesSection() {
  const { data = [] } = useQuery({ queryKey: ["my_spin_prizes"], queryFn: fetchMySpinPrizes, staleTime: 0 });
  if (!data.length) return null;
  return (
    <div className="mt-4 space-y-4">
      {data.map((p) => <PrizeCard key={p.draw_id} p={p} />)}
    </div>
  );
}

function PrizeCard({ p }: { p: MySpinPrize }) {
  const { lang } = useLanguage();
  const mr = lang === "mr";
  const L = (en: string, m: string) => (mr ? m : en);
  const qc = useQueryClient();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = mr && p.prize_mr ? p.prize_mr : p.prize;
  const refresh = () => qc.invalidateQueries({ queryKey: ["my_spin_prizes"] });

  const deadline = p.undo_deadline ? new Date(p.undo_deadline).getTime() : 0;
  const undoLeft = p.status === "pending_undo" && deadline > now ? Math.ceil((deadline - now) / 1000) : 0;
  // Once the undo window passes locally, treat as redeemed without waiting for a refetch.
  const status = p.status === "pending_undo" && !undoLeft ? "redeemed" : p.status;

  const redeem = async () => {
    setBusy(true); setErr(null);
    try { await redeemSpinPrize(p.draw_id); } catch (e) { setErr(e instanceof Error ? e.message : L("Try again", "पुन्हा प्रयत्न करा")); }
    finally { setBusy(false); await refresh(); }
  };
  const undo = async () => {
    setBusy(true); setErr(null);
    try { await undoSpinPrize(p.draw_id); } catch { setErr(L("Undo time is over", "पूर्ववत करण्याची वेळ संपली")); }
    finally { setBusy(false); await refresh(); }
  };

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-semibold text-muted-foreground">🎡 {mr && p.event_name_mr ? p.event_name_mr : p.event_name}</p>
        <p className="text-xl font-extrabold text-foreground">{name}</p>
      </div>
      {status === "redeemed" && <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary">{L("Collected ✓", "घेतले ✓")}</span>}
      {status === "expired" && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{L("Expired", "मुदत संपली")}</span>}
    </div>
  );

  if (status === "expired") {
    return <div className="rounded-2xl border bg-card p-4 opacity-50 grayscale">{header}</div>;
  }

  if (status === "redeemed" || status === "pending_undo") {
    return (
      <div className="overflow-hidden rounded-2xl border bg-card p-5 text-center">
        <style>{`@keyframes spinring{0%{transform:scale(.6);opacity:.55}100%{transform:scale(1.9);opacity:0}}`}</style>
        {header}
        <div className="relative mx-auto my-6 flex h-28 w-28 items-center justify-center">
          {[0, 1, 2].map((i) => (
            <span key={i} className="absolute inset-0 rounded-full bg-primary/30" style={{ animation: `spinring 2.4s ${i * 0.8}s ease-out infinite` }} />
          ))}
          <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
            <Check className="h-14 w-14" strokeWidth={3.5} />
          </span>
        </div>
        <p className="text-2xl font-extrabold text-primary">{name}</p>
        {p.customer_name && <p className="mt-1 text-base font-bold text-foreground">{p.customer_name}</p>}
        {p.phone_masked && <p className="text-sm text-muted-foreground">{p.phone_masked}</p>}
        <div className="mt-3"><LiveClock now={now} /> <span className="text-xs font-bold text-muted-foreground">IST</span></div>
        {p.redeemed_at && <p className="mt-2 text-xs text-muted-foreground">{L("Collected", "घेतले")} {fmtDate(p.redeemed_at)}</p>}
        {p.code && <div className="mt-5"><Qr code={p.qr || p.code} /></div>}
        {undoLeft > 0 && (
          <button disabled={busy} onClick={undo} className="mt-5 w-full rounded-full border border-border py-3 text-sm font-bold text-foreground">
            {L("Undo", "पूर्ववत करा")} ({undoLeft}s)
          </button>
        )}
        {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4">
      {header}
      {p.expires_at && <p className="mt-1 text-xs text-muted-foreground">{L("Collect by", "या वेळेपर्यंत घ्या")} {fmtDate(p.expires_at)}</p>}
      {p.code && <div className="my-4"><Qr code={p.qr || p.code} /></div>}
      <p className="mb-3 text-center text-xs text-muted-foreground">{L("Swipe at the counter in front of staff", "काउंटरवर कर्मचाऱ्यांसमोर स्वाइप करा")}</p>
      <SwipeSlider label={L("Swipe to redeem", "घेण्यासाठी स्वाइप करा")} disabled={busy} onDone={() => void redeem()} />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
    </div>
  );
}
