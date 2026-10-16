import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useLanguage } from "@/i18n";
import { toast } from "sonner";
import { ensureSignedIn } from "@/lib/authGate";
import { durationFitsNow, formatNextOpen, notifyMeForService } from "@/lib/serviceHours";
import { useBookNowAllowed, useServiceHours, type CleanServiceKey } from "@/lib/serviceSettings";
import type { SegmentService } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";
import { AddressLine, DurationCard } from "./parts";

export type CleanSheetMode = "now" | "later";

export const CL = {
  en: {
    instant: "Instant ⚡", schedule: "Schedule", duration: "How long?", vehicle: "Choose vehicle",
    day: "Which day?", time: "What time?", today: "Today", tomorrow: "Tomorrow",
    morning: "Morning", afternoon: "Afternoon", evening: "Evening",
    full: "Full", popular: "Popular", cont: "Continue", change: "Change", addAddr: "Add address",
    busy: "All experts are busy right now", off: "Book Now is off right now", closedNow: "We're closed now", opens: "Opens",
    pickDuration: "Pick how long to see times",
    dayFull: "Today's slots are full 🙏", dayFullOther: "This day is full 🙏",
    dayFullSub: "We'll tell you when a slot opens", notify: "🔔 Notify me", seeNext: "See tomorrow →",
    notified: "We'll tell you when a slot opens",
  },
  mr: {
    instant: "लगेच ⚡", schedule: "वेळ ठरवा", duration: "किती वेळ?", vehicle: "वाहन निवडा",
    day: "कोणता दिवस?", time: "किती वाजता?", today: "आज", tomorrow: "उद्या",
    morning: "सकाळ", afternoon: "दुपार", evening: "संध्याकाळ",
    full: "पूर्ण", popular: "लोकप्रिय", cont: "पुढे जा", change: "बदला", addAddr: "पत्ता जोडा",
    busy: "सध्या सर्व एक्सपर्ट व्यस्त आहेत", off: "सध्या लगेच बुकिंग बंद आहे", closedNow: "सध्या बंद आहे", opens: "उघडेल",
    pickDuration: "वेळा पाहण्यासाठी किती वेळ ते निवडा",
    dayFull: "आजचे सर्व स्लॉट भरले 🙏", dayFullOther: "हा दिवस भरला आहे 🙏",
    dayFullSub: "स्लॉट मोकळा होताच आम्ही कळवू", notify: "🔔 मला कळवा", seeNext: "उद्याचे पहा →",
    notified: "स्लॉट मोकळा होताच आम्ही कळवू",
  },
};

/** Instant ("Book Now") bottom sheet. */
export function CleanBookSheet({
  open, options, initialOptionId, isAuto, serviceKey, addressLine, onChangeAddress, onClose, onContinue, onSchedule, onOptionChange,
}: {
  open: boolean;
  options: SegmentService[];
  initialOptionId?: string | null;
  isAuto?: boolean;
  serviceKey: CleanServiceKey;
  addressLine: string | null;
  onChangeAddress: () => void;
  onClose: () => void;
  onContinue: (option: SegmentService, slot: SelectedSlot) => void;
  onSchedule: (optionId: string | null) => void;
  onOptionChange?: (id: string | null) => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? CL.mr : CL.en;
  const [optionId, setOptionId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const def = options.find((o) => Number(o.duration_minutes) === 120) ?? options[0];
    setOptionId(initialOptionId ?? def?.id ?? null);
  }, [open, initialOptionId, options]);
  useEffect(() => onOptionChange?.(optionId), [optionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: state } = useServiceHours(serviceKey, open);
  const { data: gate } = useBookNowAllowed(serviceKey, open);
  const reason = gate && !gate.allowed ? gate.reason : null;
  const closed = (state != null && !state.can_order) || reason === "closed";
  const nextOpen = closed ? formatNextOpen(state?.next_open_at ?? state?.resume_at) : null;
  const isFull = (o: SegmentService) => {
    const m = Number(o.duration_minutes) || 60;
    return closed || reason != null || (state != null && !durationFitsNow(state, m));
  };
  const notify = async () => {
    if (!(await ensureSignedIn())) return;
    const r = await notifyMeForService(serviceKey);
    if (r === "error") toast.error("Please try again");
    else toast.success(s.notified);
  };
  const allFull = options.length > 0 && options.every(isFull);
  const option = options.find((o) => o.id === optionId) ?? null;
  const optionOk = option && !isFull(option);

  useEffect(() => {
    if (option && isFull(option)) {
      const first = options.find((o) => !isFull(o));
      if (first) setOptionId(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, state]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[24px] px-5 pb-6 safe-bottom">
        <SheetTitle className="text-xl font-extrabold text-foreground">{s.instant}</SheetTitle>
        <div className="mt-3 pr-6">
          <AddressLine text={addressLine} changeLabel={s.change} addLabel={s.addAddr} onChange={onChangeAddress} />
        </div>

        <h3 className="mt-5 text-sm font-extrabold text-foreground">{isAuto ? s.vehicle : s.duration}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {options.map((o) => (
            <DurationCard key={o.id} option={o} active={o.id === optionId} full={isFull(o)} popularLabel={s.popular} fullLabel={s.full} onClick={() => setOptionId(o.id)} />
          ))}
        </div>

        {allFull && (
          <p className="mt-4 rounded-[14px] bg-surface-soft p-3 text-center text-sm font-extrabold text-foreground">
            {closed ? `${s.closedNow}${nextOpen ? ` · ${s.opens} ${nextOpen}` : ""}` : reason === "book_now_off" ? s.off : s.busy}
          </p>
        )}

        {allFull ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={notify} className="rounded-[16px] border border-border bg-card py-4 text-base font-extrabold text-foreground">{s.notify}</button>
          <button onClick={() => onSchedule(optionId)} className="w-full rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground">
            🕐 {s.schedule}
          </button>
          </div>
        ) : (
          <button
            disabled={!optionOk}
            onClick={() => option && onContinue(option, { mode: "now" })}
            className="mt-5 w-full rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground disabled:opacity-40"
          >
            {s.cont}{option ? ` · ₹${Number(option.price)}` : ""}
          </button>
        )}
      </SheetContent>
    </Sheet>
  );
}
