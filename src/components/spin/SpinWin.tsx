import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/i18n";
import { useCustomerCityId } from "@/lib/customerCity";
import { ensureSignedIn } from "@/lib/authGate";
import { doSpin, fetchSpinEvent, fetchSpinStatus, type SpinEvent, type SpinPrize } from "@/lib/spin";

function useSpinData() {
  const cityId = useCustomerCityId();
  const event = useQuery({ queryKey: ["spin_event", cityId], queryFn: () => fetchSpinEvent(cityId), staleTime: 30_000 });
  const eventId = event.data?.event_id;
  const status = useQuery({
    queryKey: ["spin_status", eventId],
    queryFn: () => fetchSpinStatus(eventId!),
    enabled: !!eventId,
    staleTime: 10_000,
  });
  return { event, status };
}

const isMr = (l: string) => l === "mr";

function Wheel({ ev, rotation, mr }: { ev: SpinEvent; rotation: number; mr: boolean }) {
  const n = Math.max(ev.slices.length, 1);
  const a = 360 / n;
  const pt = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [150 + r * Math.cos(rad), 150 + r * Math.sin(rad)];
  };
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[300px]">
      <div className="absolute left-1/2 top-[-6px] z-10 h-0 w-0 -translate-x-1/2 border-x-[12px] border-t-[22px] border-x-transparent border-t-foreground" />
      <svg
        viewBox="0 0 300 300"
        className="h-full w-full drop-shadow-xl"
        style={{ transform: `rotate(${rotation}deg)`, transition: "transform 5s cubic-bezier(0.17,0.67,0.12,1)" }}
      >
        {ev.slices.map((s, i) => {
          const [x1, y1] = pt(i * a, 145);
          const [x2, y2] = pt((i + 1) * a, 145);
          const [tx, ty] = pt(i * a + a / 2, 95);
          return (
            <g key={s.prize_id}>
              <path
                d={`M150 150 L${x1} ${y1} A145 145 0 ${a > 180 ? 1 : 0} 1 ${x2} ${y2} Z`}
                fill={s.sold_out ? "hsl(0 0% 75%)" : s.color}
                stroke="white"
                strokeWidth="2"
              />
              <text
                x={tx} y={ty} fill="white" fontSize="11" fontWeight="700" textAnchor="middle"
                transform={`rotate(${i * a + a / 2} ${tx} ${ty})`}
              >
                {(mr ? s.label_mr : s.label).slice(0, 16)}
                {s.sold_out && <tspan x={tx} dy="13" fontSize="9">{mr ? "संपले" : "Sold out"}</tspan>}
              </text>
            </g>
          );
        })}
        <circle cx="150" cy="150" r="22" fill="white" stroke="hsl(0 0% 85%)" strokeWidth="3" />
      </svg>
    </div>
  );
}

function Confetti() {
  const colors = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"];
  return (
    <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
      <style>{`@keyframes spinconf{to{transform:translateY(110vh) rotate(720deg)}}`}</style>
      {Array.from({ length: 70 }).map((_, i) => (
        <span
          key={i}
          className="absolute top-[-20px] block h-3 w-2 rounded-sm"
          style={{
            left: `${(i * 37) % 100}%`, background: colors[i % 5],
            animation: `spinconf ${2 + (i % 5) * 0.4}s ${(i % 10) * 0.08}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

export function prizeMessage(p: SpinPrize, mr: boolean) {
  if (p.type === "physical") return mr ? "डील्समध्ये तुमचे बक्षीस दाखवा आणि घ्या" : "Show this in Deals at the counter to collect";
  if (p.type === "wallet" || p.type.includes("wallet")) return mr ? `₹${p.value} तुमच्या वॉलेटमध्ये जमा` : `₹${p.value} added to your wallet`;
  if (p.type.includes("coupon")) return mr ? "कूपन जोडले — चेकआउटला वापरा" : "Coupon added — use it at checkout";
  return mr ? "तुमचे बक्षीस खात्यात जोडले" : "Your reward has been added";
}

export function SpinModal({ ev, onClose, onOpenDeals }: { ev: SpinEvent; onClose: () => void; onOpenDeals?: () => void }) {
  const { lang } = useLanguage();
  const mr = isMr(lang);
  const qc = useQueryClient();
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [prize, setPrize] = useState<SpinPrize | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const spin = async () => {
    if (busy || prize) return;
    setBusy(true); setErr(null);
    setRotation((r) => r + 720); // start motion right away
    try {
      const p = await doSpin(ev.event_id);
      const n = ev.slices.length;
      const a = 360 / n;
      const target = 360 * 6 + (360 - (p.slice_index * a + a / 2));
      setRotation(target);
      setTimeout(() => {
        setPrize(p); setBusy(false);
        qc.invalidateQueries({ queryKey: ["spin_status"] });
      }, 5100);
    } catch (e) {
      setBusy(false);
      setRotation(0);
      setErr(mr ? "फिरवता आले नाही. पुन्हा प्रयत्न करा." : `Couldn't spin. ${e instanceof Error && !/fetch|network/i.test(e.message) ? e.message : "Check your internet and try again."}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/95 p-5 backdrop-blur">
      {prize && <Confetti />}
      <button aria-label="Close" onClick={onClose} disabled={busy} className="absolute right-4 top-[calc(var(--app-safe-top,0px)+16px)] rounded-full bg-muted p-2">
        <X className="h-5 w-5" />
      </button>
      <div className="w-full max-w-sm text-center">
        <h2 className="text-3xl font-extrabold">{mr ? "🎡 फिरवा आणि जिंका!" : "🎡 Spin & Win!"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{mr ? ev.name_mr : ev.name}</p>
        <div className="my-6"><Wheel ev={ev} rotation={rotation} mr={mr} /></div>
        {prize ? (
          <div className="rounded-2xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{mr ? "तुम्ही जिंकलात" : "You won"}</p>
            <p className="text-2xl font-extrabold text-primary">{mr ? prize.label_mr : prize.label}</p>
            <p className="mt-1 text-sm">{prizeMessage(prize, mr)}</p>
            <button
              className="mt-4 w-full rounded-full bg-primary py-3 font-bold text-primary-foreground"
              onClick={() => { onClose(); if (prize.type === "physical") onOpenDeals?.(); }}
            >
              {prize.type === "physical" ? (mr ? "डील्समध्ये पहा" : "View in Deals") : mr ? "छान!" : "Great!"}
            </button>
          </div>
        ) : (
          <>
            {err && <p className="mb-3 text-sm text-destructive">{err}</p>}
            <button onClick={spin} disabled={busy} className="w-full rounded-full bg-primary py-4 text-lg font-extrabold text-primary-foreground disabled:opacity-70">
              {busy ? (mr ? "फिरत आहे…" : "Spinning…") : mr ? "फिरवा" : "SPIN"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Auto-opens the wheel once after the user signs in, if eligible. */
export function SpinAutoPopup({ onOpenDeals }: { onOpenDeals?: () => void }) {
  const qc = useQueryClient();
  const { event, status } = useSpinData();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e) => {
      if (e === "SIGNED_IN") { setDismissed(false); qc.invalidateQueries({ queryKey: ["spin_status"] }); }
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);
  useEffect(() => {
    if (!dismissed && status.data?.status === "eligible") setOpen(true);
  }, [status.data, dismissed]);
  if (!open || !event.data) return null;
  return <SpinModal ev={event.data} onClose={() => { setOpen(false); setDismissed(true); }} onOpenDeals={onOpenDeals} />;
}

/** Card shown at the top of Rewards → Deals. */
export function SpinDealsCard() {
  const { lang } = useLanguage();
  const mr = isMr(lang);
  const { event, status } = useSpinData();
  const [open, setOpen] = useState(false);
  const ev = event.data;
  if (!ev) return null;
  const s = status.data;
  if (s?.status === "not_live") return null;
  const msg: Record<string, [string, string]> = {
    device_used: ["This phone has already been used for a spin.", "या फोनवरून आधीच फिरवले आहे."],
    phone_used: ["This mobile number has already spun.", "या मोबाईल नंबरने आधीच फिरवले आहे."],
    not_eligible: ["Spin & Win is only for new customers who joined during the event.", "फिरवा आणि जिंका फक्त कार्यक्रमादरम्यान जोडलेल्या नवीन ग्राहकांसाठी आहे."],
    sign_in: ["Sign in to spin the wheel.", "चाक फिरवण्यासाठी साइन इन करा."],
  };
  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <p className="text-lg font-extrabold">{mr ? "🎡 फिरवा आणि जिंका!" : "🎡 Spin & Win!"}</p>
      <p className="text-xs text-muted-foreground">{mr ? ev.name_mr : ev.name}</p>
      {s?.status === "already_spun" ? (
        <div className="mt-3">
          <p className="font-bold">{mr ? "तुम्ही जिंकलात" : "You won"} {mr ? s.prize.label_mr : s.prize.label}</p>
          <p className="text-sm text-muted-foreground">{prizeMessage(s.prize, mr)}</p>
          {s.prize.type === "physical" && s.prize.redemption_code && (
            <div className="mt-3 rounded-xl bg-muted p-3 text-center">
              <p className="text-xs text-muted-foreground">{s.prize.redeemed ? (mr ? "घेतले" : "Collected") : mr ? "काउंटरवर हा कोड दाखवा" : "Show this code at the counter"}</p>
              <p className={`text-2xl font-black tracking-widest ${s.prize.redeemed ? "line-through opacity-50" : ""}`}>{s.prize.redemption_code}</p>
            </div>
          )}
        </div>
      ) : s?.status === "eligible" ? (
        <button onClick={() => setOpen(true)} className="mt-3 w-full rounded-full bg-primary py-3 font-bold text-primary-foreground">
          {mr ? "आता फिरवा" : "Spin now"}
        </button>
      ) : s && msg[s.status] ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{mr ? msg[s.status][1] : msg[s.status][0]}</p>
          {s.status === "sign_in" && (
            <button onClick={() => void ensureSignedIn()} className="mt-3 w-full rounded-full bg-primary py-3 font-bold text-primary-foreground">
              {mr ? "साइन इन" : "Sign in"}
            </button>
          )}
        </>
      ) : null}
      {open && <SpinModal ev={ev} onClose={() => setOpen(false)} />}
    </div>
  );
}
