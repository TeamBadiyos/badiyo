import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useCustomerCityId } from "@/lib/customerCity";
import { ensureSignedIn } from "@/lib/authGate";
import { useLanguage } from "@/i18n";
import { getAllHourSlots, getNext7DayOptions, isHourBookable } from "@/lib/hourSlots";
import { fetchSlotAllowed, notifyMeForService, slotFitsWindow, timeToMinutes } from "@/lib/serviceHours";
import { fetchAppFullySlots, useServiceHours, type CleanServiceKey } from "@/lib/serviceSettings";
import type { SegmentService } from "@/lib/segments";
import type { SelectedSlot } from "../SlotSelectionScreen";
import { CL } from "./CleanBookSheet";
import { AddressLine, DayCard, DurationCard, FullCalendarArt } from "./parts";

export type ScheduleDraft = { optionId: string | null; day: string | null; slotMins: number | null };

export function CleanScheduleScreen({
  options, isAuto, serviceKey, addressLine, draft, onDraftChange, onChangeAddress, onBack, onContinue,
}: {
  options: SegmentService[];
  isAuto?: boolean;
  serviceKey: CleanServiceKey;
  addressLine: string | null;
  draft: ScheduleDraft;
  onDraftChange: (d: ScheduleDraft) => void;
  onChangeAddress: () => void;
  onBack: () => void;
  onContinue: (option: SegmentService, slot: SelectedSlot) => void;
}) {
  const { lang } = useLanguage();
  const s = lang === "mr" ? CL.mr : CL.en;
  const cityId = useCustomerCityId();
  const days = useMemo(getNext7DayOptions, []);
  const [optionId, setOptionId] = useState<string | null>(draft.optionId);
  const [day, setDay] = useState<string>(draft.day ?? days[0].key);
  const [slotMins, setSlotMins] = useState<number | null>(draft.slotMins);
  useEffect(() => onDraftChange({ optionId, day, slotMins }), [optionId, day, slotMins]); // eslint-disable-line react-hooks/exhaustive-deps

  const option = options.find((o) => o.id === optionId) ?? null;
  const mins = Number(option?.duration_minutes) || 60;

  const { data: state } = useServiceHours(serviceKey);
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
  const isFull = (m: number) => (fullSlots?.has(`${day}|${m}`) ?? false) || dayAllowed?.get(m) === false;
  const dayFull = !!option && !!dayAllowed && !isFetching && visible.every((x) => isFull(x.mins));

  useEffect(() => {
    if (slotMins !== null && (isFull(slotMins) || !visible.some((x) => x.mins === slotMins))) setSlotMins(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSlots, dayAllowed, day, mins]);

  const groups = [
    { label: s.morning, list: visible.filter((x) => x.mins < 720) },
    { label: s.afternoon, list: visible.filter((x) => x.mins >= 720 && x.mins < 960) },
    { label: s.evening, list: visible.filter((x) => x.mins >= 960) },
  ].filter((g) => g.list.length > 0);

  const dayIdx = days.findIndex((d) => d.key === day);
  const dayLabel = (i: number) => (i === 0 ? s.today : i === 1 ? s.tomorrow : days[i].weekday);
  const canContinue = !!option && slotMins !== null && !isFull(slotMins);

  const go = () => {
    if (!option || slotMins === null) return;
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
          <h1 className="text-xl font-extrabold text-foreground">{s.schedule}</h1>
        </div>
        <div className="mt-4">
          <AddressLine text={addressLine} changeLabel={s.change} addLabel={s.addAddr} onChange={onChangeAddress} />
        </div>

        <h3 className="mt-6 text-base font-extrabold text-foreground">{s.day}</h3>
        <div className="-mx-5 mt-3 flex gap-2.5 overflow-x-auto px-5 pb-1">
          {days.map((d, i) => (
            <DayCard key={d.key} label={dayLabel(i)} sub={i < 2 ? `${d.weekday} ${d.dayNum}` : String(d.dayNum)} active={d.key === day} onClick={() => setDay(d.key)} />
          ))}
        </div>

        <h3 className="mt-6 text-base font-extrabold text-foreground">{isAuto ? s.vehicle : s.duration}</h3>
        <div className="-mx-5 mt-3 flex gap-2.5 overflow-x-auto px-5 pb-1 pt-2">
          {options.map((o) => (
            <DurationCard key={o.id} option={o} active={o.id === optionId} popularLabel={s.popular} fullLabel={s.full} onClick={() => setOptionId(o.id)} className="min-w-[104px] shrink-0" />
          ))}
        </div>

        {!option ? (
          <p className="mt-6 text-sm text-muted-foreground">{s.pickDuration}</p>
        ) : dayFull || visible.length === 0 ? (
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
            {groups.map((g) => (
              <div key={g.label} className="mt-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {g.list.map((x) => {
                    const full = isFull(x.mins);
                    const active = x.mins === slotMins;
                    return (
                      <button
                        key={x.mins}
                        disabled={full}
                        onClick={() => setSlotMins(x.mins)}
                        className={`rounded-[12px] border-2 px-1 py-2 text-center text-[13px] font-bold ${
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
