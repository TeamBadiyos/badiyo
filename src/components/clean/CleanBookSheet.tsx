import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CalendarClock, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { withCity, useCustomerCityId } from "@/lib/customerCity";
import { ensureSignedIn } from "@/lib/authGate";
import { useLanguage } from "@/i18n";
import { getAllHourSlots, getNext7DayOptions, isHourBookable } from "@/lib/hourSlots";
import {
  fetchFullyBookedSlots,
  fetchInstantBookingEnabled,
  fetchSlotAllowed,
  notifyMeForService,
  slotFitsWindow,
  durationFitsNow,
  formatNextOpen,
  timeToMinutes,
  useServiceState,
} from "@/lib/serviceHours";
import type { SegmentService } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";

export type CleanSheetMode = "now" | "later";

const L = {
  en: {
    now: "Book Now",
    later: "Schedule",
    duration: "How long?",
    vehicle: "Choose vehicle",
    day: "Pick a day",
    time: "Pick a time",
    full: "Full",
    noSlots: "No slots left on this day. Try another day.",
    busy: "All experts are busy right now",
    closedNow: "We're closed now", opens: "Opens",
    busySub: "Schedule a time, or we'll tell you when one is free.",
    notify: "Notify me",
    cont: "Continue",
    change: "Change",
    addAddr: "Add address",
    notified: "We'll tell you when an expert is free",
  },
  mr: {
    now: "आत्ता बुक करा",
    later: "वेळ ठरवा",
    duration: "किती वेळ?",
    vehicle: "वाहन निवडा",
    day: "दिवस निवडा",
    time: "वेळ निवडा",
    full: "पूर्ण",
    noSlots: "या दिवशी वेळ उपलब्ध नाही. दुसरा दिवस निवडा.",
    busy: "सध्या सर्व एक्सपर्ट व्यस्त आहेत",
    closedNow: "सध्या बंद आहे", opens: "उघडेल",
    busySub: "वेळ ठरवा, किंवा एक्सपर्ट मोकळा होताच आम्ही कळवू.",
    notify: "मला कळवा",
    cont: "पुढे जा",
    change: "बदला",
    addAddr: "पत्ता जोडा",
    notified: "एक्सपर्ट मोकळा होताच आम्ही कळवू",
  },
};

export function CleanBookSheet({
  open,
  mode,
  onModeChange,
  options,
  initialOptionId,
  isAuto,
  addressLine,
  onChangeAddress,
  onClose,
  onContinue,
}: {
  open: boolean;
  mode: CleanSheetMode;
  onModeChange: (m: CleanSheetMode) => void;
  options: SegmentService[];
  initialOptionId?: string | null;
  isAuto?: boolean;
  addressLine: string | null;
  onChangeAddress: () => void;
  onClose: () => void;
  onContinue: (option: SegmentService, slot: SelectedSlot) => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? L.mr : L.en;
  const [optionId, setOptionId] = useState<string | null>(null);
  const days = useMemo(getNext7DayOptions, []);
  const [day, setDay] = useState(days[0].key);
  const [slotMins, setSlotMins] = useState<number | null>(null);
  const cityId = useCustomerCityId();

  useEffect(() => {
    if (!open) return;
    setOptionId(initialOptionId ?? options[0]?.id ?? null);
    setSlotMins(null);
  }, [open, initialOptionId, options]);

  const option = options.find((o) => o.id === optionId) ?? null;
  const mins = Number(option?.duration_minutes) || 60;

  const { data: state } = useServiceState("clean", open);
  // Slot range follows the service hours setting (open → close), IST.
  const openM = timeToMinutes(state?.open_time);
  const closeM = timeToMinutes(state?.close_time);
  const allSlots = useMemo(
    () => (openM != null && closeM != null ? getAllHourSlots(openM, closeM - 30) : getAllHourSlots()),
    [openM, closeM],
  );
  const isClosed = state != null && !state.can_order;
  const nextOpen = isClosed ? formatNextOpen(state?.next_open_at ?? state?.resume_at) : null;
  const { data: instantEnabled = true } = useQuery({
    queryKey: ["instant-booking-enabled"],
    queryFn: fetchInstantBookingEnabled,
    enabled: open && mode === "now",
    staleTime: 30_000,
  });
  const { data: gate } = useQuery({
    queryKey: ["instant-allowed", mins, cityId],
    enabled: open && mode === "now",
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.rpc(
        "service_instant_allowed" as never,
        withCity({ _service_key: "clean", _duration_minutes: mins }) as never,
      );
      return (data as { ok?: boolean; reason_code?: string } | null) ?? null;
    },
  });
  const nowBlocked =
    (state != null && !state.can_order) ||
    instantEnabled === false ||
    gate?.ok === false ||
    (state != null && state.can_order && !durationFitsNow(state, mins));

  const { data: fullSlots } = useQuery({
    queryKey: ["fully-booked-slots", days[0].key, days[6].key, cityId],
    enabled: open && mode === "later",
    staleTime: 30_000,
    queryFn: () => fetchFullyBookedSlots("clean", days[0].key, days[6].key),
  });
  const { data: dayAllowed } = useQuery({
    queryKey: ["service-slots", day, mins],
    enabled: open && mode === "later",
    staleTime: 60_000,
    queryFn: async () =>
      new Map(
        await Promise.all(
          allSlots.map(
            async (x) => [x.mins, await fetchSlotAllowed("clean", day, x.range, mins)] as const,
          ),
        ),
      ),
  });

  const visible = allSlots.filter((x) => isHourBookable(day, x.mins) && slotFitsWindow(state, x.mins, mins));
  const isFull = (m: number) =>
    (fullSlots?.has(`${day}|${m}`) ?? false) || dayAllowed?.get(m) === false;

  useEffect(() => {
    if (slotMins !== null && isFull(slotMins)) setSlotMins(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSlots, dayAllowed, day]);

  const canContinue =
    !!option && (mode === "now" ? !nowBlocked : slotMins !== null && !isFull(slotMins));

  const go = () => {
    if (!option || !canContinue) return;
    if (mode === "now") return onContinue(option, { mode: "now" });
    const slot = allSlots.find((x) => x.mins === slotMins)!;
    onContinue(option, {
      mode: "later",
      day,
      slotId: slot.mins,
      slotLabel: slot.label,
      slotRange: slot.range,
    });
  };

  const notify = async () => {
    if (!(await ensureSignedIn())) return;
    const r = await notifyMeForService("clean");
    if (r === "error") toast.error("Please try again");
    else toast.success(s.notified);
  };

  const chip = (active: boolean, disabled = false) =>
    `shrink-0 rounded-[14px] border px-3 py-2 text-sm font-bold transition ${
      disabled
        ? "border-border bg-muted text-muted-foreground"
        : active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground"
    }`;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[24px] px-5 pb-6 safe-bottom">
        <SheetTitle className="sr-only">{mode === "now" ? s.now : s.later}</SheetTitle>
        <button onClick={onChangeAddress} className="flex w-full items-center gap-2 pr-8 text-left text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-bold text-foreground">{addressLine || s.addAddr}</span>
          <span className="font-extrabold text-primary">{s.change}</span>
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-[14px] bg-muted p-1">
          {(["now", "later"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`rounded-[10px] py-2 text-sm font-extrabold ${mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {m === "now" ? `⚡ ${s.now}` : `🕐 ${s.later}`}
            </button>
          ))}
        </div>

        <h3 className="mt-5 text-sm font-extrabold text-foreground">{isAuto ? s.vehicle : s.duration}</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((o) => (
            <button key={o.id} onClick={() => setOptionId(o.id)} className={chip(o.id === optionId)}>
              {o.duration_label} · ₹{Number(o.price)}
            </button>
          ))}
        </div>

        {mode === "now" ? (
          nowBlocked && option ? (
            <div className="mt-5 rounded-[18px] bg-surface-soft p-4 text-center">
              <p className="text-base font-extrabold text-foreground">
                {isClosed ? `${s.closedNow}${nextOpen ? ` · ${s.opens} ${nextOpen}` : ""}` : s.busy}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{s.busySub}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => onModeChange("later")} className="flex items-center justify-center gap-1.5 rounded-[14px] bg-primary py-3 text-sm font-extrabold text-primary-foreground">
                  <CalendarClock className="h-4 w-4" /> {s.later}
                </button>
                <button onClick={notify} className="flex items-center justify-center gap-1.5 rounded-[14px] border border-border bg-card py-3 text-sm font-extrabold text-foreground">
                  <BellRing className="h-4 w-4" /> {s.notify}
                </button>
              </div>
            </div>
          ) : null
        ) : (
          <>
            <h3 className="mt-5 text-sm font-extrabold text-foreground">{s.day}</h3>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {days.map((d) => (
                <button key={d.key} onClick={() => { setDay(d.key); setSlotMins(null); }} className={`${chip(d.key === day)} flex flex-col items-center px-3.5`}>
                  <span className="text-[11px] font-semibold opacity-80">{d.weekday}</span>
                  <span>{d.dayNum}</span>
                </button>
              ))}
            </div>
            <h3 className="mt-5 text-sm font-extrabold text-foreground">{s.time}</h3>
            {visible.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{s.noSlots}</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {visible.map((x) => {
                  const full = isFull(x.mins);
                  return (
                    <button key={x.mins} disabled={full} onClick={() => setSlotMins(x.mins)} className={chip(x.mins === slotMins, full)}>
                      {x.label}
                      {full && <span className="block text-[10px] font-semibold">{s.full}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <button
          disabled={!canContinue}
          onClick={go}
          className="mt-6 w-full rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground disabled:opacity-40"
        >
          {s.cont}
          {option ? ` · ₹${Number(option.price)}` : ""}
        </button>
      </SheetContent>
    </Sheet>
  );
}
