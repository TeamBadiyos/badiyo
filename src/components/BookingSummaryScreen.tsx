import { ArrowLeft, Clock, Calendar, Home as HomeIcon } from "lucide-react";
import type { SelectedService, SelectedSlot } from "./SlotSelectionScreen";
import { useT, type TFunction } from "@/i18n";
import { hapticImpact } from "@/lib/haptics";

export type SelectedAddress = {
  id: string;
  label: string | null;
  full_address: string;
  area: string | null;
  city: string | null;
  is_default: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
};

function formatSlot(slot: SelectedSlot, t: TFunction): { title: string; subtitle: string } {
  if (slot.mode === "now") {
    return {
      title: t("summary.now"),
      subtitle: t("summary.nowSub"),
    };
  }
  const date = new Date(slot.day);
  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return {
    title: `${dateLabel} · ${slot.slotLabel}`,
    subtitle: t("summary.between", { range: slot.slotRange }),
  };
}

export function BookingSummaryScreen({
  service,
  slot,
  address,
  onBack,
  onEditAddress,
  onProceedToPay,
}: {
  service: SelectedService;
  slot: SelectedSlot;
  address: SelectedAddress;
  onBack: () => void;
  onEditAddress: () => void;
  onProceedToPay: () => void;
}) {
  const t = useT();
  const slotInfo = formatSlot(slot, t);

  return (
    <main className="min-h-screen w-full bg-background pb-28">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-base font-bold text-foreground">
            {t("summary.title")}
          </h1>
        </div>

        {/* Service card */}
        <section className="mt-6 flex items-start gap-4 rounded-[18px] border border-border bg-card p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Clock className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-bold text-foreground">
              {service.duration_label}
            </div>
            {service.subtitle && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {service.subtitle}
              </div>
            )}
            <div className="mt-1 text-sm font-bold text-primary">
              {t("common.rupees", { amount: service.price })}
            </div>
          </div>
        </section>

        {/* Slot card */}
        <section className="mt-4 flex items-start gap-4 rounded-[18px] border border-border bg-card p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Calendar className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {t("common.when")}
            </div>
            <div className="mt-1 text-base font-bold text-foreground">
              {slotInfo.title}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {slotInfo.subtitle}
            </div>
          </div>
        </section>

        {/* Address card */}
        <section className="mt-4 flex items-start gap-4 rounded-[18px] border border-border bg-card p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <HomeIcon className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {t("common.address")}
              </div>
              <button
                onClick={onEditAddress}
                className="text-xs font-bold text-primary"
              >
                {t("common.edit")}
              </button>
            </div>
            <div className="mt-1 text-base font-bold text-foreground">
              {address.label || t("address.fallbackLabel")}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {address.full_address}
            </div>
          </div>
        </section>

        {/* Price breakdown */}
        <section className="mt-6 rounded-[18px] border border-border bg-card p-5">
          <div className="text-sm font-bold text-foreground">
            {t("summary.priceDetails")}
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("summary.servicePrice")}</span>
            <span className="text-foreground">
              {t("common.rupees", { amount: service.price })}
            </span>
          </div>
          <div className="my-4 h-px bg-border" />
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-foreground">{t("common.total")}</span>
            <span className="text-base font-bold text-foreground">
              {t("common.rupees", { amount: service.price })}
            </span>
          </div>
        </section>
      </div>

      {/* Fixed pay button */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card safe-bottom">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-4 px-5 py-4">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("common.total")}</span>
            <span className="text-base font-bold text-foreground">
              {t("common.rupees", { amount: service.price })}
            </span>
          </div>
          <button
            onClick={() => { void hapticImpact("medium"); onProceedToPay(); }}
            className="flex-1 rounded-[14px] bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground transition active:scale-[0.99]"
          >
            {t("summary.proceedToPay")}
          </button>
        </div>
      </div>
    </main>
  );
}
