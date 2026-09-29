import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  getAllHourSlots,
  getNext7DayOptions,
  isHourBookable,
} from "@/lib/hourSlots";
import {
  formatClockLabel,
  formatDurationLabel,
  slotFitsWindow,
  slotStartHour,
  useServiceState,
} from "@/lib/serviceHours";

export function RescheduleSheet({
  open,
  initialDate,
  initialSlot,
  durationMinutes,
  onClose,
  onConfirm,
  saving,
}: {
  open: boolean;
  initialDate: string | null;
  initialSlot: string | null;
  /** Service length, used so the job still finishes before closing time. */
  durationMinutes?: number | null;
  onClose: () => void;
  onConfirm: (date: string, slotLabel: string) => void;
  saving?: boolean;
}) {
  const days = useMemo(getNext7DayOptions, []);
  const allSlots = useMemo(getAllHourSlots, []);
  const [selectedDay, setSelectedDay] = useState<string | null>(initialDate);
  const [selectedHour, setSelectedHour] = useState<number | null>(() =>
    initialSlot ? slotStartHour(initialSlot) : null,
  );
  const { data: cleanState } = useServiceState("clean", open);
  const duration = durationMinutes && durationMinutes > 0 ? durationMinutes : 60;

  const tooLong = (hour: number) => !slotFitsWindow(cleanState, hour, duration);
  const [tooLongMsg, setTooLongMsg] = useState<string | null>(null);

  const visibleSlots = useMemo(() => {
    if (!selectedDay) return allSlots;
    return allSlots.filter((s) => isHourBookable(selectedDay, s.hour));
  }, [selectedDay, allSlots]);

  if (!open) return null;

  const canContinue =
    selectedDay && selectedHour !== null && !tooLong(selectedHour);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40">
      <div className="mx-auto w-full max-w-md animate-slide-up rounded-t-[24px] bg-card p-5 pb-[calc(var(--app-safe-bottom)+20px)] shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold text-foreground">Reschedule booking</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"
          >
            <X className="h-4 w-4 text-foreground" />
          </button>
        </div>

        <h3 className="mt-3 text-sm font-bold text-foreground">Choose a day</h3>
        <div className="mt-2 -mx-1 overflow-x-auto px-1">
          <div className="flex gap-2 pb-1">
            {days.map((d) => {
              const key = d.key;
              const active = selectedDay === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedDay(key);
                    if (
                      selectedHour !== null &&
                      !isHourBookable(key, selectedHour)
                    ) {
                      setSelectedHour(null);
                    }
                  }}
                  className={`flex min-w-[60px] flex-col items-center rounded-[14px] border px-3 py-2.5 text-center transition ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  <span className="text-xs font-semibold text-muted-foreground">
                    {d.weekday}
                  </span>
                  <span className="mt-1 text-lg font-bold">{d.dayNum}</span>
                </button>
              );
            })}
          </div>
        </div>

        <h3 className="mt-5 text-sm font-bold text-foreground">Choose a time</h3>
        {selectedDay && visibleSlots.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No time slots left for today. Please pick another day.
          </p>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-2">
            {visibleSlots.map((slot) => {
              const active = selectedHour === slot.hour;
              const blocked = tooLong(slot.hour);
              return (
                <button
                  key={slot.hour}
                  onClick={() => {
                    if (blocked) {
                      setSelectedHour(null);
                      setTooLongMsg(
                        `This service takes about ${formatDurationLabel(
                          duration,
                        )}, so a ${slot.label} start won't finish before we close${
                          formatClockLabel(cleanState?.close_time)
                            ? ` at ${formatClockLabel(cleanState?.close_time)}`
                            : ""
                        }. Please pick an earlier time.`,
                      );
                      return;
                    }
                    setTooLongMsg(null);
                    setSelectedHour(slot.hour);
                  }}
                  className={`rounded-[14px] border px-3 py-2.5 text-sm font-semibold transition ${
                    blocked
                      ? "border-border bg-muted text-muted-foreground/50"
                      : active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground"
                  }`}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        )}

        {tooLongMsg && (
          <p className="mt-3 text-sm font-semibold text-destructive">{tooLongMsg}</p>
        )}

        <button
          disabled={!canContinue || saving}
          onClick={() => {
            if (!selectedDay || selectedHour === null) return;
            const s = allSlots.find((x) => x.hour === selectedHour)!;
            onConfirm(selectedDay, s.range);
          }}
          className={`mt-6 w-full rounded-[14px] px-4 py-3.5 text-sm font-bold transition ${
            canContinue && !saving
              ? "bg-primary text-primary-foreground active:scale-[0.99]"
              : "bg-primary/30 text-primary-foreground/70"
          }`}
        >
          {saving ? "Saving…" : "Confirm reschedule"}
        </button>
      </div>
    </div>
  );
}
