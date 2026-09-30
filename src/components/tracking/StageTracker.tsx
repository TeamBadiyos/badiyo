import { Check } from "lucide-react";
import { useT } from "@/i18n";
import type { TranslationKey } from "@/i18n/en";

export type TrackingStage =
  | "booking_placed"
  | "confirming"
  | "expert_assigned"
  | "service_started"
  | "completed";

const STAGES: { key: TrackingStage; labelKey: TranslationKey }[] = [
  { key: "booking_placed", labelKey: "stage.placed" },
  { key: "confirming", labelKey: "stage.confirming" },
  { key: "expert_assigned", labelKey: "stage.assigned" },
  { key: "service_started", labelKey: "stage.started" },
  { key: "completed", labelKey: "stage.completed" },
];

export function stageFromStatus(status: string | null | undefined): TrackingStage {
  switch (status) {
    case "confirmed":
      return "confirming";
    case "accepted":
      return "confirming";
    case "expert_assigned":
    case "on_the_way":
    case "arrived":
      return "expert_assigned";
    case "in_progress":
      return "service_started";
    case "completed":
      return "completed";
    default:
      return "booking_placed";
  }
}

export function StageTracker({ stage }: { stage: TrackingStage }) {
  const t = useT();
  const currentIdx = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {STAGES.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s.key} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div
                  className={`h-[2px] flex-1 ${
                    i === 0 ? "bg-transparent" : done || active ? "bg-primary" : "bg-border"
                  }`}
                />
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <div
                  className={`h-[2px] flex-1 ${
                    i === STAGES.length - 1
                      ? "bg-transparent"
                      : done
                        ? "bg-primary"
                        : "bg-border"
                  }`}
                />
              </div>
              <div
                className={`mt-1.5 text-[10px] font-medium ${
                  active ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {t(s.labelKey)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
