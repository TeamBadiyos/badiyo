import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Droplets, Package, X } from "lucide-react";
import { toast } from "sonner";
import { useCustomerCityId } from "@/lib/customerCity";
import { ensureSignedIn } from "@/lib/authGate";
import { useBackHandler } from "@/lib/backHandler";
import { useLanguage } from "@/i18n";
import { getAllHourSlots, getNext7DayOptions, isHourBookable } from "@/lib/hourSlots";
import { notifyMeForService, slotFitsWindow, timeToMinutes } from "@/lib/serviceHours";
import { fetchAppFullySlots, pick, useBookNowAllowed, useServiceContent, useServiceHours, type CleanServiceKey } from "@/lib/serviceSettings";
import type { SegmentService } from "@/lib/segments";
import type { SelectedSlot } from "@/lib/bookingTypes";
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
  options, isAuto, serviceKey, title, addressLine, draft, fallbackImage, onDraftChange, onChangeAddress, onBack, onContinue,
}: {
  options: SegmentService[];
  isAuto?: boolean;
  serviceKey: CleanServiceKey;
  title?: string;
  addressLine: string | null;
  draft: ScheduleDraft;
  fallbackImage: (o: SegmentService) => string;
  onDraftChange: (d: ScheduleDraft) => void;
  onChangeAddress: () => void;
  onBack: () => void;
  onContinue: (option: SegmentService, slot: SelectedSlot) => void | Promise<unknown>;
}) {
  useBackHandler(true, () => onBack());
  const { lang } = useLanguage();
  const s = lang === "mr" ? CL.mr : CL.en;
  const cityId = useCustomerCityId();
  const days = useMemo(() => getNext7DayOptions().slice(0, 3), []);
  const [optionId, setOptionId] = useState<string | null>(
    draft.optionId ?? (options.find((o) => Number(o.duration_minutes) === 60) ?? options[0])?.id ?? null,
  );
  const [day, setDay] = useState<string>(draft.day && days.some((d) => d.key === draft.day) ? draft.day : days[0].key);
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

  const { data: fullSlots, isFetching } = useQuery({
    queryKey: ["app-fully-booked", serviceKey, days[0].key, days[days.length - 1].key, cityId],
    staleTime: 30_000,
    queryFn: () => fetchAppFullySlots(serviceKey, days[0].key, days[days.length - 1].key),
  });
  const visible = allSlots.filter((x) => isHourBookable(day, x.mins) && slotFitsWindow(state, x.mins, mins));
  const isFull = (m: number) => m !== NOW && (fullSlots?.has(`${day}|${m}`) ?? false);
  const loaded = !!option && !!fullSlots && !isFetching;
  const dayFull = loaded && !nowOk && visible.every((x) => isFull(x.mins));

  // Pre-select earliest available (Now first when offered); drop invalid choice.
  useEffect(() => {
    const valid = slotMins === NOW ? nowOk : slotMins !== null && !isFull(slotMins) && visible.some((x) => x.mins === slotMins);
    if (valid) return;
    if (nowOk) return setSlotMins(NOW);
    if (!loaded) return;
    setSlotMins(visible.find((x) => !isFull(x.mins))?.mins ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSlots, day, mins, nowOk, loaded]);

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

  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!option || slotMins === null || busy) return;
    const slot = slotMins === NOW ? null : allSlots.find((x) => x.mins === slotMins)!;
    setBusy(true);
    try {
      await (slot
        ? onContinue(option, { mode: "later", day, slotId: slot.mins, slotLabel: slot.label, slotRange: slot.range, serviceKey })
        : onContinue(option, { mode: "now", serviceKey }));
    } finally {
      setBusy(false);
    }
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
          <h1 className="text-xl font-extrabold text-foreground">{title || s.book}</h1>
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
        <ScrollRow className="mt-3 gap-2.5">
          {days.map((d, i) => (
            <DayCard key={d.key} label={dayLabel(i)} sub={i < 2 ? `${d.weekday} ${d.dayNum}` : String(d.dayNum)} active={d.key === day} onClick={() => setDay(d.key)} />
          ))}
        </ScrollRow>

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
                <ScrollRow className="mt-2 gap-2">
                  {g.list.map((x) => {
                    const full = isFull(x.mins);
                    const active = x.mins === slotMins;
                    return (
                      <button
                        key={x.mins}
                        disabled={full}
                        onClick={() => setSlotMins(x.mins)}
                        className={`w-[96px] shrink-0 rounded-[14px] border-2 px-2 py-3 text-center text-sm ${
                          full ? "border-border bg-muted font-bold text-muted-foreground" : active ? "border-primary bg-primary/5 font-extrabold text-foreground" : "border-border bg-card font-bold text-foreground"
                        }`}
                      >
                        {x.label}
                        {full && <span className="block text-[10px] font-semibold">{s.full}</span>}
                      </button>
                    );
                  })}
                </ScrollRow>
              </div>
            ))}
          </>
        )}

        {isAuto && <IncludedCard serviceKey={serviceKey} option={option} lang={lang} />}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background px-5 py-3 safe-bottom">
        <button disabled={!canContinue || busy} onClick={() => void go()} className="mx-auto block w-full max-w-md rounded-[16px] bg-primary py-4 text-base font-extrabold text-primary-foreground disabled:opacity-40">
          {busy ? "…" : <>{s.cont}{option ? ` · ₹${Number(option.price)}` : ""}</>}
        </button>
      </div>
    </div>
  );
}

/** What's included / not included for the chosen vehicle, from Command Center content. */
function IncludedCard({ serviceKey, option, lang }: { serviceKey: CleanServiceKey; option: SegmentService | null; lang: string }) {
  const { data: content } = useServiceContent(serviceKey);
  if (!option || !content?.cards?.length) return null;
  const mr = lang === "mr";
  const norm = (x?: string | null) => (x ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const card =
    content.cards.find((c) => c.price_option_id === option.id) ??
    content.cards.find((c) => norm(c.title).startsWith(norm(option.duration_label)));
  if (!card) return null;
  const lines = (arr: unknown): string[] => (Array.isArray(arr) ? arr : []).map((x) => {
    if (typeof x === "string") return x.trim();
    if (x && typeof x === "object") {
      const o = x as { en?: unknown; mr?: unknown };
      const en = typeof o.en === "string" ? o.en.trim() : "";
      const m = typeof o.mr === "string" ? o.mr.trim() : "";
      return mr ? m || en : en || m;
    }
    return "";
  }).filter(Boolean);
  const inc = lines(mr && card.included_mr?.length ? card.included_mr : card.included);
  const exc = lines(mr && card.not_included_mr?.length ? card.not_included_mr : card.not_included);
  const d = content.details;
  const t = (en?: string | null, m?: string | null, fb = "") => ((mr && m?.trim() ? m : en)?.trim() || fb);
  const note = t(d?.note, d?.note_mr);
  const NoteIcon = d?.note_icon === "water" ? Droplets : Package;
  if (!inc.length && !exc.length && !note) return null;
  return (
    <div className="mt-8 rounded-[20px] border border-border bg-card p-4">
      <p className="text-base font-extrabold text-foreground">{mr ? "यात काय समाविष्ट आहे?" : "What's included?"} · {pick(lang, card.title, card.title_mr)}</p>
      {inc.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-extrabold text-foreground">{t(d?.included_title, d?.included_title_mr, mr ? "समाविष्ट" : "Included")}</p>
          <ul className="mt-1.5 space-y-1.5">{inc.map((x, i) => <li key={i} className="flex gap-2 text-sm text-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{x}</li>)}</ul>
        </div>
      )}
      {exc.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-extrabold text-foreground">{t(d?.excluded_title, d?.excluded_title_mr, mr ? "समाविष्ट नाही" : "Not included")}</p>
          <ul className="mt-1.5 space-y-1.5">{exc.map((x, i) => <li key={i} className="flex gap-2 text-sm text-muted-foreground"><X className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{x}</li>)}</ul>
        </div>
      )}
      {note && (
        <div className="mt-4 flex items-start gap-3 rounded-[14px] bg-surface-soft p-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><NoteIcon className="h-4 w-4" /></span>
          <p className="text-sm font-semibold text-foreground">{note}</p>
        </div>
      )}
    </div>
  );
}

/** Horizontal row with a right-edge fade + › while more items remain. */
function ScrollRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    upd();
    el.addEventListener("scroll", upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", upd); ro.disconnect(); };
  }, [children]);
  return (
    <div className="relative -mx-5">
      <div ref={ref} className={`flex overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>{children}</div>
      <div aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-background via-background/80 to-transparent pr-1.5 transition-opacity ${more ? "opacity-100" : "opacity-0"}`}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-card text-base font-extrabold leading-none text-primary shadow-sm">›</span>
      </div>
    </div>
  );
}
