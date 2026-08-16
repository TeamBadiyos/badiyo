import { useMemo, useState } from "react";
import { ArrowLeft, Clock, Info } from "lucide-react";
import {
  getAllHourSlots,
  isHourBookable,
  toDateKey,
} from "@/lib/hourSlots";
import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";
import { WhatsIncludedSheet } from "./WhatsIncludedSheet";

export type SelectedService = {
  duration_label: string;
  duration_minutes: number;
  price: number;
  subtitle: string | null;
  icon: string | null;
  segment_id?: string | null;
  segment_name?: string | null;
  task_slug?: string | null;
};

export type SelectedSlot =
  | { mode: "now" }
  | {
      mode: "later";
      day: string;
      slotId: number; // hour in 24h
      slotLabel: string;
      slotRange: string;
    };

type Mode = "now" | "later";

function getNext7Days() {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

export function SlotSelectionScreen({
  service,
  onBack,
  onContinue,
}: {
  service: SelectedService;
  onBack: () => void;
  onContinue: (slot: SelectedSlot) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("now");
  const days = useMemo(getNext7Days, []);
  const allSlots = useMemo(getAllHourSlots, []);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [includedOpen, setIncludedOpen] = useState(false);

  const visibleSlots = useMemo(() => {
    if (!selectedDay) return allSlots;
    return allSlots.filter((s) => isHourBookable(selectedDay, s.hour));
  }, [selectedDay, allSlots]);

  const canContinue =
    mode === "now" || (selectedDay !== null && selectedHour !== null);

  return (
    <main className="min-h-screen w-full bg-background pb-28">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-sm font-bold text-foreground">
            {service.duration_label} · {t("common.rupees", { amount: service.price })}
          </h1>
        </div>

        <button
          onClick={() => setIncludedOpen(true)}
          className="mt-4 flex w-full items-center gap-2 rounded-[14px] border border-primary/40 bg-primary/5 px-4 py-3 text-left"
        >
          <Info className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-bold text-primary">{t("included.link")}</span>
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-[14px] border border-border bg-card p-1">
          {(["now", "later"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { void hapticSelection(); setMode(m); }}
              className={`rounded-[10px] px-4 py-2.5 text-sm font-bold transition ${
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {m === "now" ? t("slot.bookNow") : t("slot.scheduleLater")}
            </button>
          ))}
        </div>

        {mode === "now" && (
          <div className="mt-6 flex items-start gap-4 rounded-[18px] border border-border bg-card p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-primary/10">
              <Clock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="text-base font-bold text-foreground">
                {t("slot.arriveTitle")}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t("slot.arriveSub")}</p>
            </div>
          </div>
        )}

        {mode === "later" && (
          <>
            <h2 className="mt-6 text-sm font-bold text-foreground">
              {t("slot.chooseDay")}
            </h2>
            <div className="mt-3 -mx-5 overflow-x-auto px-5">
              <div className="flex gap-2 pb-1">
                {days.map((d) => {
                  const key = toDateKey(d);
                  const active = selectedDay === key;
                  const weekday = d.toLocaleDateString("en-US", {
                    weekday: "short",
                  });
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
                      className={`flex min-w-[64px] flex-col items-center rounded-[14px] border px-3 py-3 text-center transition ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-foreground"
                      }`}
                    >
                      <span className="text-xs font-semibold text-muted-foreground">
                        {weekday}
                      </span>
                      <span className="mt-1 text-lg font-bold">
                        {d.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <h2 className="mt-6 text-sm font-bold text-foreground">
              {t("slot.chooseTime")}
            </h2>
            {selectedDay && visibleSlots.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("slot.noSlots")}
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {visibleSlots.map((slot) => {
                  const active = selectedHour === slot.hour;
                  return (
                    <button
                      key={slot.hour}
                      onClick={() => { void hapticSelection(); setSelectedHour(slot.hour); }}
                      className={`rounded-[14px] border px-3 py-3 text-sm font-semibold transition ${
                        active
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
          </>
        )}
      </div>

      <WhatsIncludedSheet
        open={includedOpen}
        segmentId={service.segment_id ?? null}
        taskSlug={service.task_slug ?? null}
        onClose={() => setIncludedOpen(false)}
      />

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card safe-bottom">
        <div className="mx-auto w-full max-w-md px-5 py-4">
          <button
            disabled={!canContinue}
            onClick={() => {
              if (mode === "now") {
                onContinue({ mode: "now" });
              } else if (selectedDay && selectedHour !== null) {
                const s = allSlots.find((x) => x.hour === selectedHour)!;
                onContinue({
                  mode: "later",
                  day: selectedDay,
                  slotId: selectedHour,
                  slotLabel: s.label,
                  slotRange: s.range,
                });
              }
            }}
            className={`w-full rounded-[14px] px-4 py-3.5 text-sm font-bold transition ${
              canContinue
                ? "bg-primary text-primary-foreground active:scale-[0.99]"
                : "bg-primary/30 text-primary-foreground/70"
            }`}
          >
            {t("common.continue")}
          </button>
        </div>
      </div>
    </main>
  );
}
