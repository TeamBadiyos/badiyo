import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useCustomerCityId } from "@/lib/customerCity";
import { ensureSignedIn } from "@/lib/authGate";
import { useLanguage } from "@/i18n";
import { getAllHourSlots, getNext7DayOptions, isHourBookable } from "@/lib/hourSlots";
import { fetchSlotAllowed, notifyMeForService, slotFitsWindow, timeToMinutes } from "@/lib/serviceHours";
import { fetchAppFullySlots, useBookNowAllowed, useServiceHours, type CleanServiceKey } from "@/lib/serviceSettings";
import type { SegmentService } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";
import { AddressLine, DayCard, FullCalendarArt, OptionImageCard } from "./parts";

export const CL = {
  en: {
    book: "Book", duration: "How long?", vehicle: "Choose vehicle", day: "Which day?", time: "What time?",
    today: "Today", tomorrow: "Tomorrow", morning: "Morning", afternoon: "Afternoon", evening: "Evening",
    full: "Full", now: "Now ⚡", cont: "Continue", change: "Change", addAddr: "Add address",
    dayFull: "Today's slots are full 🙏", dayFullOther: "This day is full 🙏",
    dayFullSub: "We'll tell you when a slot opens", notify: "🔔 Notify me", seeNext: "See next day →",
    notified: "We'll tell you when a slot opens", included: "Included", notIncluded: "Not included", bookNow: "Book Now",
  },
  mr: {
    book: "बुक करा", duration: "किती वेळ?", vehicle: "वाहन निवडा", day: "कोणता दिवस?", time: "किती वाजता?",
    today: "आज", tomorrow: "उद्या", morning: "सकाळ", afternoon: "दुपार", evening: "संध्याकाळ",
    full: "पूर्ण", now: "आत्ता ⚡", cont: "पुढे जा", change: "बदला", addAddr: "पत्ता जोडा",
    dayFull: "आजचे सर्व स्लॉट भरले 🙏", dayFullOther: "हा दिवस भरला आहे 🙏",
    dayFullSub: "स्लॉट मोकळा होताच आम्ही कळवू", notify: "🔔 मला कळवा", seeNext: "पुढचा दिवस पहा →",
    notified: "स्लॉट मोकळा होताच आम्ही कळवू", included: "समाविष्ट", notIncluded: "समाविष्ट नाही", bookNow: "बुक करा",
  },
};

export type ScheduleDraft = { optionId: string | null; day: string | null; slotMins: number | null };
const NOW = -1;

export function CleanScheduleScreen({
  options, isAuto, serviceKey, addressLine, draft, fallbackImage, onDraftChange, onChangeAddress, onBack, onContinue,
}: {
  options: SegmentService[];
  isAuto?: boolean;
  serviceKey: CleanServiceKey;
  addressLine: string | null;
  draft: ScheduleDraft;
  fallbackImage: (o: SegmentService) => string;
  onDraftChange: (d: ScheduleDraft) => void;
  onChangeAddress: () => void;
  onBack: () => void;
  onContinue: (option: SegmentService, slot: SelectedSlot) => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? CL.mr : CL.en;
  const cityId = useCustomerCityId();
  const days = useMemo(getNext7DayOptions, []);
  const [optionId, setOptionId] = useState<string | null>(
    draft.optionId ?? (options.find((o) => Number(o.duration_minutes) === 120) ?? options[0])?.id ?? null,
  );
  const [day, setDay] = useState<string>(draft.day ?? days[0].key);
  const [slotMins, setSlotMins] = useState<number | null>(draft.slotMins);
  useEffect(() => onDraftChange({ optionId, day, slotMins }), [optionId, day, slotMins]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = options.find((o) => o.id === optionId) ?? null;
  const mins = Number(option?.duration_minutes) || 60;

  const { data: state } = useServiceHours(serviceKey);
  const { data: gate } = useBookNowAllowed(serviceKey);
  const isToday = day === days[0].key;
  const nowOk = isToday && !!gate?.allowed && (state == null || state.can_order);

  const openM = timeToMinutes(state?.open_time);
  const closeM = timeToMinutes(state?.close_time);
  const allSlots = useMemo(
    () => (openM != null && closeM != null ? getAllHourSlots(openM, closeM - 30) : getAllHourSlots()),
    [openM, closeM],
  );

  const { data: fullSlots } = useQuery({
    queryKey: ["app-fully-booked", serviceKey, days[0].key, days[6].key, cityId],
    staleTime: 30_000,
    queryFn: () => fetchAppFullySlots(serviceKey, days[0].key, days[6].key),
  });
  const { data: dayAllowed, isFetching } = useQuery({
    queryKey: ["service-slots", serviceKey, day, mins, allSlots.length],
    enabled: !!option,
    staleTime: 60_000,
    queryFn: async () =>
      new Map(await Promise.all(allSlots.map(async (x) => [x.mins, await fetchSlotAllowed(serviceKey, day, x.range, mins)] as const))),
  });

  const visible = allSlots.filter((x) => isHourBookable(day, x.mins) && slotFitsWindow(state, x.mins, mins));
  const isFull = (m: number) => m !== NOW && ((fullSlots?.has(`${day}|${m}`) ?? false) || dayAllowed?.get(m) === false);
  const loaded = !!option && !!dayAllowed && !isFetching;
  const dayFull = loaded && !nowOk && visible.every((x) => isFull(x.mins));

  // Pre-select earliest available (Now first when offered); drop invalid choice.
  useEffect(() => {
    const valid = slotMins === NOW ? nowOk : slotMins !== null && !isFull(slotMins) && visible.some((x) => x.mins === slotMins);
    if (valid) return;
    if (nowOk) return setSlotMins(NOW);
    if (!loaded) return;
    setSlotMins(visible.find((x) => !isFull(x.mins))?.mins ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSlots, dayAllowed, day, mins, nowOk, loaded]);

  type Cell = { mins: number; label: string };
  const nowCell: Cell = { mins: NOW, label: s.now };
  const groups: { label: string; list: Cell[] }[] = [
    { label: s.morning, list: visible.filter((x) => x.mins < 720) as Cell[] },
    { label: s.afternoon, list: visible.filter((x) => x.mins >= 720 && x.mins < 960) as Cell[] },
    { label: s.evening, list: visible.filter((x) => x.mins >= 960) as Cell[] },
  ];
  if (nowOk) {
    const g = groups.find((x) => x.list.length > 0) ?? groups[0];
    g.list = [nowCell, ...g.list];
  }
  const shownGroups = groups.filter((g) => g.list.length > 0);

  const dayIdx = days.findIndex((d) => d.key === day);
  const dayLabel = (i: number) => (i === 0 ? s.today : i === 1 ? s.tomorrow : days[i].weekday);
  const canContinue = !!option && slotMins !== null && !isFull(slotMins);

  const go = () => {
    if (!option || slotMins === null) return;
    if (slotMins === NOW) return onContinue(option, { mode: "now" });
    const slot = allSlots.find((x) => x.mins === slotMins)!;
    onContinue(option, { mode: "later", day, slotId: slot.mins, slotLabel: slot.label, slotRange: slot.range });
  };
  const notify = async () => {
    if (!(await ensureSignedIn())) return;
    const r = await notifyMeForService(serviceKey);
    if (r === "error") toast.error("Please try again");
    else toast.success(s.notified);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background pb-28">
      <div className="mx-auto max-w-md px-5 safe-top">
        <div className="flex items-center gap-3 pt-4">
          <button onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-xl font-extrabold text-foreground">{s.book}</h1>
        </div>
        <div className="mt-4">
          <AddressLine text={addressLine} changeLabel={s.change} addLabel={s.addAddr} onChange={onChangeAddress} />
        </div>

        <h3 className="mt-6 text-base font-extrabold text-foreground">{isAuto ? s.vehicle : s.duration}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {options.map((o) => (
            <OptionImageCard key={o.id} name={o.duration_label} imageUrl={o.image_url || fallbackImage(o)} price={Number(o.price)}
              original={o.strikethrough_price != null ? Number(o.strikethrough_price) : null} active={o.id === optionId} onClick={() => setOptionId(o.id)} />
          ))}
        </div>

        <h3 className="mt-6 text-base font-extrabold text-foreground">{s.day}</h3>
        <div className="-mx-5 mt-3 flex gap-2.5 overflow-x-auto px-5 pb-1">
          {days.map((d, i) => (
            <DayCard key={d.key} label={dayLabel(i)} sub={i < 2 ? `${d.weekday} ${d.dayNum}` : String(d.dayNum)} active={d.key === day} onClick={() => setDay(d.key)} />
          ))}
        </div>

        {option && (dayFull || (loaded && shownGroups.length === 0)) ? (
          <div className="mt-6 rounded-[20px] bg-surface-soft p-5 text-center">
            <FullCalendarArt fullLabel={s.full} />
            <p className="mt-3 text-base font-extrabold text-foreground">{dayIdx === 0 ? s.dayFull : s.dayFullOther}</p>
            <p className="mt-1 text-sm text-muted-foreground">{s.dayFullSub}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={notify} className="rounded-[14px] border border-border bg-card py-3 text-sm font-extrabold text-foreground">{s.notify}</button>
              {dayIdx < days.length - 1 && (
                <button onClick={() => setDay(days[dayIdx + 1].key)} className="rounded-[14px] bg-primary py-3 text-sm font-extrabold text-primary-foreground">{s.seeNext}</button>
              )}
            </div>
          </div>
        ) : (
          <>
            <h3 className="mt-6 text-base font-extrabold text-foreground">{s.time}</h3>
            {shownGroups.map((g) => (
              <div key={g.label} className="mt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                <div className="-mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
                  {g.list.map((x) => {
                    const full = isFull(x.mins);
                    const active = x.mins === slotMins;
                    return (
                      <button
                        key={x.mins}
                        disabled={full}
                        onClick={() => setSlotMins(x.mins)}
                        className={`min-w-[88px] shrink-0 rounded-[14px] border-2 px-3 py-3 text-center text-sm font-bold ${
                          full ? "border-border bg-muted text-muted-foreground" : active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
                        }`}
                      >
                        {x.label}
                        {full && <span className="block text-[10px] font-semibold">{s.full}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 py-3 safe-bottom">
        <button disabled={!canContinue} onClick={go} className="mx-auto block w-full max-w-md rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground disabled:opacity-40">
          {s.cont}{option ? ` · ₹${Number(option.price)}` : ""}
        </button>
      </div>
    </div>
  );
}
