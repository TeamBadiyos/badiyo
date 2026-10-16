import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { withCity, useCustomerCityId } from "@/lib/customerCity";
import { useLanguage } from "@/i18n";
import { durationFitsNow, fetchInstantBookingEnabled, formatNextOpen, useServiceState } from "@/lib/serviceHours";
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
    busy: "All experts are busy right now", closedNow: "We're closed now", opens: "Opens",
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
    busy: "सध्या सर्व एक्सपर्ट व्यस्त आहेत", closedNow: "सध्या बंद आहे", opens: "उघडेल",
    pickDuration: "वेळा पाहण्यासाठी किती वेळ ते निवडा",
    dayFull: "आजचे सर्व स्लॉट भरले 🙏", dayFullOther: "हा दिवस भरला आहे 🙏",
    dayFullSub: "स्लॉट मोकळा होताच आम्ही कळवू", notify: "🔔 मला कळवा", seeNext: "उद्याचे पहा →",
    notified: "स्लॉट मोकळा होताच आम्ही कळवू",
  },
};

/** Instant ("Book Now") bottom sheet. */
export function CleanBookSheet({
  open, options, initialOptionId, isAuto, addressLine, onChangeAddress, onClose, onContinue, onSchedule, onOptionChange,
}: {
  open: boolean;
  options: SegmentService[];
  initialOptionId?: string | null;
  isAuto?: boolean;
  addressLine: string | null;
  onChangeAddress: () => void;
  onClose: () => void;
  onContinue: (option: SegmentService, slot: SelectedSlot) => void;
  onSchedule: (optionId: string | null) => void;
  onOptionChange?: (id: string | null) => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? CL.mr : CL.en;
  const cityId = useCustomerCityId();
  const [optionId, setOptionId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const def = options.find((o) => Number(o.duration_minutes) === 120) ?? options[0];
    setOptionId(initialOptionId ?? def?.id ?? null);
  }, [open, initialOptionId, options]);
  useEffect(() => onOptionChange?.(optionId), [optionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: state } = useServiceState("clean", open);
  const closed = state != null && !state.can_order;
  const nextOpen = closed ? formatNextOpen(state?.next_open_at ?? state?.resume_at) : null;
  const { data: instantEnabled = true } = useQuery({
    queryKey: ["instant-booking-enabled"], queryFn: fetchInstantBookingEnabled, enabled: open, staleTime: 30_000,
  });
  const durations = [...new Set(options.map((o) => Number(o.duration_minutes) || 60))];
  const { data: gates } = useQuery({
    queryKey: ["instant-allowed-all", durations.join(","), cityId],
    enabled: open && options.length > 0,
    staleTime: 30_000,
    queryFn: async () =>
      new Map(
        await Promise.all(
          durations.map(async (m) => {
            const { data } = await supabase.rpc(
              "service_instant_allowed" as never,
              withCity({ _service_key: "clean", _duration_minutes: m }) as never,
            );
            return [m, (data as { ok?: boolean } | null)?.ok !== false] as const;
          }),
        ),
      ),
  });
  const isFull = (o: SegmentService) => {
    const m = Number(o.duration_minutes) || 60;
    return closed || instantEnabled === false || gates?.get(m) === false || (state != null && !durationFitsNow(state, m));
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
  }, [gates, state, instantEnabled]);

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
            {closed ? `${s.closedNow}${nextOpen ? ` · ${s.opens} ${nextOpen}` : ""}` : s.busy}
          </p>
        )}

        {allFull ? (
          <button onClick={() => onSchedule(optionId)} className="mt-5 w-full rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground">
            🕐 {s.schedule}
          </button>
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
