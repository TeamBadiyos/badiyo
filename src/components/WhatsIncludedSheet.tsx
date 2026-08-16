import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Info, Loader2, X } from "lucide-react";
import { fetchServiceTaskDetails } from "@/lib/taskDetails";
import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";
import { pushBackHandler } from "@/lib/backHandler";

export function WhatsIncludedSheet({
  open,
  segmentId,
  taskSlug,
  onClose,
  onSchedule,
  onBookInstant,
}: {
  open: boolean;
  segmentId?: string | null;
  /** Slug of the task whose tab should be selected by default. */
  taskSlug?: string | null;
  onClose: () => void;
  onSchedule?: () => void;
  onBookInstant?: () => void;
}) {
  const t = useT();
  const { data: tasks = [], isLoading, isError } = useQuery({
    queryKey: ["service_task_details", segmentId ?? "all"],
    queryFn: () => fetchServiceTaskDetails(segmentId),
    enabled: open,
    staleTime: 1000 * 60 * 30,
  });

  const [activeSlug, setActiveSlug] = useState<string | null>(taskSlug ?? null);

  useEffect(() => {
    if (open) setActiveSlug(taskSlug ?? null);
  }, [open, taskSlug]);

  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => onClose());
  }, [open, onClose]);

  const active = useMemo(() => {
    if (tasks.length === 0) return null;
    return tasks.find((x) => x.task_slug === activeSlug) ?? tasks[0];
  }, [tasks, activeSlug]);

  if (!open) return null;

  const showActions = Boolean(onSchedule || onBookInstant);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex max-h-[85vh] w-full max-w-md animate-slide-up flex-col rounded-t-[24px] bg-card shadow-xl safe-bottom"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3">
          <span className="h-1.5 w-10 rounded-full bg-muted" />
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pt-3">
          <h2 className="text-base font-bold text-foreground">{t("included.title")}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"
          >
            <X className="h-4 w-4 text-foreground" />
          </button>
        </div>

        {/* Tabs */}
        {tasks.length > 0 && (
          <div className="mt-3 overflow-x-auto px-5 momentum-scroll">
            <div className="flex gap-2 pb-1">
              {tasks.map((task) => {
                const isActive = active?.task_slug === task.task_slug;
                return (
                  <button
                    key={task.id}
                    onClick={() => {
                      void hapticSelection();
                      setActiveSlug(task.task_slug);
                    }}
                    className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {task.icon_url ? (
                      <img
                        src={task.icon_url}
                        alt=""
                        loading="lazy"
                        className="h-5 w-5 rounded-full object-cover"
                      />
                    ) : null}
                    <span className="whitespace-nowrap">{task.task_name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 pt-4 momentum-scroll">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : isError || !active ? (
            <div className="flex flex-col items-center rounded-[18px] border border-dashed border-border px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Info className="h-6 w-6 text-primary" />
              </div>
              <p className="mt-3 text-sm font-bold text-foreground">
                {t("included.emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("included.emptyBody")}
              </p>
            </div>
          ) : (
            <>
              {active.included_items.length > 0 && (
                <section>
                  <h3 className="text-sm font-bold text-foreground">
                    {t("included.trainedTo")}
                  </h3>
                  <ul className="mt-3 flex flex-col gap-2.5">
                    {active.included_items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                          <Check className="h-3.5 w-3.5 text-primary" />
                        </span>
                        <span className="text-sm text-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {active.excluded_items.length > 0 && (
                <section className="mt-6">
                  <h3 className="text-sm font-bold text-foreground">
                    {t("included.notIncluded")}
                  </h3>
                  <ul className="mt-3 flex flex-col gap-2.5">
                    {active.excluded_items.map((item, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15">
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </span>
                        <span className="text-sm text-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {active.included_items.length === 0 &&
                active.excluded_items.length === 0 && (
                  <div className="flex flex-col items-center rounded-[18px] border border-dashed border-border px-6 py-10 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <Info className="h-6 w-6 text-primary" />
                    </div>
                    <p className="mt-3 text-sm font-bold text-foreground">
                      {t("included.emptyTitle")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("included.emptyBody")}
                    </p>
                  </div>
                )}

              <p className="mt-6 rounded-[14px] bg-muted px-4 py-3 text-xs font-semibold text-muted-foreground">
                {t("included.equipmentNote")}
              </p>
            </>
          )}
        </div>

        {showActions && (
          <div className="border-t border-border px-5 py-4">
            <div className="flex items-center gap-3">
              {onSchedule && (
                <button
                  onClick={onSchedule}
                  className="flex-1 rounded-[14px] border border-primary px-4 py-3 text-sm font-bold text-primary transition active:scale-[0.99]"
                >
                  {t("included.schedule")}
                </button>
              )}
              {onBookInstant && (
                <button
                  onClick={onBookInstant}
                  className="flex-1 rounded-[14px] bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition active:scale-[0.99]"
                >
                  {t("included.bookInstant")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
