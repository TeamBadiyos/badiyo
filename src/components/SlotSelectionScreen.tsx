import { useMemo, useState } from "react";
import { Check, ChevronDown, Clock, X } from "lucide-react";
import {
  getAllHourSlots,
  isHourBookable,
  toDateKey,
} from "@/lib/hourSlots";
import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";
import { MediaGallery, type MediaItem } from "./product/MediaGallery";

export type TaskTypeDetail = {
  id: string;
  name: string;
  inclusions: string[];
  exclusions: string[];
};

export type SelectedService = {
  duration_label: string;
  duration_minutes: number;
  price: number;
  subtitle: string | null;
  icon: string | null;
  segment_id?: string | null;
  segment_name?: string | null;
  task_slug?: string | null;
  /** Rich product-detail fields (all optional — older callers fall back). */
  service_name?: string | null;
  strikethrough_price?: number | null;
  pricing_type?: string | null;
  image_url?: string | null;
  gallery_urls?: string[] | null;
  video_url?: string | null;
  description?: string | null;
  inclusions?: string[] | null;
  exclusions?: string[] | null;
  /** Per-task-type breakdown; takes precedence over the flat lists. */
  task_types?: TaskTypeDetail[] | null;
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
function IncExcLists({
  inclusions,
  exclusions,
  includedLabel,
  notIncludedLabel,
}: {
  inclusions: string[];
  exclusions: string[];
  includedLabel: string;
  notIncludedLabel: string;
}) {
  return (
    <>
      {inclusions.length > 0 && (
        <>
          <h3 className="text-xs font-bold uppercase tracking-[0.04em] text-muted-foreground">
            {includedLabel}
          </h3>
          <ul className="mt-3 flex flex-col gap-2.5">
            {inclusions.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                  <Check className="h-3.5 w-3.5 text-primary" />
                </span>
                <span className="selectable text-sm text-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {exclusions.length > 0 && (
        <>
          <h3
            className={`text-xs font-bold uppercase tracking-[0.04em] text-muted-foreground ${
              inclusions.length > 0 ? "mt-5" : ""
            }`}
          >
            {notIncludedLabel}
          </h3>
          <ul className="mt-3 flex flex-col gap-2.5">
            {exclusions.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15">
                  <X className="h-3.5 w-3.5 text-destructive" />
                </span>
                <span className="selectable text-sm text-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
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
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [openTaskIds, setOpenTaskIds] = useState<string[]>([]);


  const media: MediaItem[] = useMemo(() => {
    const urls = [service.image_url, ...(service.gallery_urls ?? [])].filter(
      (u): u is string => typeof u === "string" && u.trim().length > 0,
    );
    const seen = new Set<string>();
    const items: MediaItem[] = [];
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ kind: "image", url });
    }
    if (service.video_url) items.push({ kind: "video", url: service.video_url });
    return items;
  }, [service.image_url, service.gallery_urls, service.video_url]);

  const inclusions = (service.inclusions ?? []).filter((x) => x?.trim());
  const exclusions = (service.exclusions ?? []).filter((x) => x?.trim());
  const taskTypes = useMemo(
    () =>
      (service.task_types ?? [])
        .map((tt) => ({
          ...tt,
          inclusions: (tt.inclusions ?? []).filter((x) => x?.trim()),
          exclusions: (tt.exclusions ?? []).filter((x) => x?.trim()),
        }))
        .filter((tt) => tt.inclusions.length > 0 || tt.exclusions.length > 0),
    [service.task_types],
  );
  const hasFlatDetails = inclusions.length > 0 || exclusions.length > 0;
  const hasDetails = taskTypes.length > 0 || hasFlatDetails;

  const description = service.description?.trim() || null;
  const isFlat = service.pricing_type === "flat";
  const title = service.service_name?.trim() || service.duration_label;

  const visibleSlots = useMemo(() => {
    if (!selectedDay) return allSlots;
    return allSlots.filter((s) => isHourBookable(selectedDay, s.hour));
  }, [selectedDay, allSlots]);

  const canContinue =
    mode === "now" || (selectedDay !== null && selectedHour !== null);

  return (
    <main className="min-h-screen w-full bg-background pb-32">
      <div className="mx-auto w-full max-w-md">
        {/* Media gallery */}
        <div className="relative">
          {media.length > 0 ? (
            <MediaGallery items={media} alt={title} />
          ) : (
            <div className="h-4" />
          )}
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center safe-top"
          >
            {/* Inline SVG so the glyph paints in the same frame as the circle. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-5 w-5 text-foreground"
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>

        </div>

        <div className="px-5 pt-4">
          {/* Name + price */}
          <h1 className="text-lg font-bold leading-tight tracking-[-0.01em] text-foreground">
            {title}
          </h1>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-[-0.02em] text-foreground">
              {t("common.rupees", { amount: service.price })}
            </span>
            {service.strikethrough_price != null &&
              Number(service.strikethrough_price) > Number(service.price) && (
                <span className="text-sm font-semibold text-muted-foreground line-through">
                  {t("common.rupees", { amount: Number(service.strikethrough_price) })}
                </span>
              )}
            {!isFlat && (
              <span className="text-sm font-semibold text-muted-foreground">
                · {service.duration_label}
              </span>
            )}
          </div>
          {service.subtitle && (
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {service.subtitle}
            </p>
          )}

          {/* Description */}
          {description && (
            <p className="selectable mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}

          {/* Details */}
          {hasDetails && (
            <section className="mt-5 overflow-hidden rounded-[18px] border border-border bg-card shadow-card-m">
              <button
                onClick={() => setDetailsOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3.5 text-left"
              >
                <span className="text-sm font-bold text-foreground">
                  {t("product.details")}
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    detailsOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {detailsOpen && (
                <div className="border-t border-border">
                  {taskTypes.length > 0 ? (
                    <div className="flex flex-col">
                      {taskTypes.map((tt) => {
                        const open = openTaskIds.includes(tt.id);
                        return (
                          <div
                            key={tt.id}
                            className="border-b border-border last:border-b-0"
                          >
                            <button
                              onClick={() => {
                                void hapticSelection();
                                setOpenTaskIds((prev) =>
                                  prev.includes(tt.id)
                                    ? prev.filter((x) => x !== tt.id)
                                    : [...prev, tt.id],
                                );
                              }}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                            >
                              <span className="text-sm font-bold text-foreground">
                                {tt.name}
                              </span>
                              <ChevronDown
                                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                                  open ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                            {open && (
                              <div className="px-4 pb-4">
                                <IncExcLists
                                  inclusions={tt.inclusions}
                                  exclusions={tt.exclusions}
                                  includedLabel={t("product.included")}
                                  notIncludedLabel={t("product.notIncluded")}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-4">
                      <IncExcLists
                        inclusions={inclusions}
                        exclusions={exclusions}
                        includedLabel={t("product.included")}
                        notIncludedLabel={t("product.notIncluded")}
                      />
                    </div>
                  )}
                </div>
              )}

            </section>
          )}

          {/* Slot picker */}
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-[14px] border border-border bg-card p-1">
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
            <div className="mt-5 flex items-start gap-4 rounded-[18px] border border-border bg-card p-5">
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
              <h2 className="mt-5 text-sm font-bold text-foreground">
                {t("slot.chooseDay")}
              </h2>
              <div className="mt-3 -mx-5 overflow-x-auto px-5 momentum-scroll">
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
                        <span className="mt-1 text-lg font-bold">{d.getDate()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <h2 className="mt-5 text-sm font-bold text-foreground">
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
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card safe-bottom">
        <div className="mx-auto flex w-full max-w-md items-center gap-4 px-5 py-4">
          <div className="flex flex-col">
            <span className="text-[15px] font-bold tracking-[-0.02em] text-foreground">
              {t("common.rupees", { amount: service.price })}
            </span>
            {!isFlat && (
              <span className="text-[11px] font-semibold text-muted-foreground">
                {service.duration_label}
              </span>
            )}
          </div>
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
            className={`flex-1 rounded-[14px] px-4 py-3.5 text-sm font-bold transition ${
              canContinue
                ? "bg-primary text-primary-foreground active:scale-[0.99]"
                : "bg-primary/30 text-primary-foreground/70"
            }`}
          >
            {mode === "now" ? t("slot.bookNow") : t("slot.scheduleLater")}
          </button>
        </div>
      </div>
    </main>
  );
}
