import { ArrowLeft, Check, ChevronRight, Clock, Calendar, Home as HomeIcon, Tag, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { SelectedService, SelectedSlot } from "./SlotSelectionScreen";
import { useT, type TFunction } from "@/i18n";
import { hapticImpact } from "@/lib/haptics";
import { billBreakdown, useGstPercent } from "@/lib/gst";
import { fetchMyCoupons, type AppliedCoupon } from "@/lib/coupons";

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
  coupon,
  onCouponChange,
  onOpenCoupons,
  onBack,
  onEditAddress,
  onProceedToPay,
}: {
  service: SelectedService;
  slot: SelectedSlot;
  address: SelectedAddress;
  coupon: AppliedCoupon | null;
  onCouponChange: (coupon: AppliedCoupon | null) => void;
  onOpenCoupons: () => void;
  onBack: () => void;
  onEditAddress: () => void;
  onProceedToPay: () => void;
}) {
  const t = useT();
  const slotInfo = formatSlot(slot, t);
  const gstPercent = useGstPercent();
  const bill = billBreakdown(
    Number(service.price),
    gstPercent,
    coupon?.discount ?? 0,
  );
  const tax = bill.gst;
  const discount = bill.discount;
  const total = bill.total;
  const { data: availableCoupons } = useQuery({
    queryKey: ["my_coupons"],
    queryFn: fetchMyCoupons,
    staleTime: 60_000,
  });

  return (
    <main className="min-h-screen w-full bg-background pb-28">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onBack}
            aria-label={t("common.back")}
            className="rounded-full"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Button>
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onEditAddress}
                className="h-8 px-2 text-xs font-bold text-primary"
              >
                {t("common.edit")}
              </Button>
            </div>
            <div className="mt-1 text-base font-bold text-foreground">
              {address.label || t("address.fallbackLabel")}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {address.full_address}
            </div>
          </div>
        </section>

        {/* Coupon */}
        <section className="mt-4 overflow-hidden rounded-[18px] border border-border bg-card">
          {coupon ? (
            <div className="flex items-center gap-3 bg-primary/5 px-5 py-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Check className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{coupon.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {coupon.code} · {t("coupon.saved", { amount: coupon.discount.toFixed(2) })}
                </p>
              </div>
              <span className="shrink-0 text-sm font-extrabold text-primary">−₹{coupon.discount.toFixed(2)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("coupon.remove")}
                onClick={() => onCouponChange(null)}
                className="h-8 w-8 shrink-0 rounded-full"
              >
                <X className="h-4 w-4 text-foreground" />
              </Button>
            </div>
          ) : null}
          {coupon && <div className="mx-5 border-t border-dashed border-border" />}
          <Button
            type="button"
            variant="ghost"
            onClick={onOpenCoupons}
            className="h-auto w-full justify-between rounded-none px-5 py-4 hover:bg-muted"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Tag className="h-5 w-5 shrink-0 text-primary" />
              <span className="truncate text-sm font-bold text-foreground">
                {coupon ? t("coupon.change") : t("coupon.viewAll")}
              </span>
              {!coupon && availableCoupons && availableCoupons.length > 0 && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  {availableCoupons.length}
                </span>
              )}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </section>

        {/* Price breakdown */}
        <section className="mt-4 rounded-[18px] border border-border bg-card p-5">
          <div className="text-sm font-bold text-foreground">
            {t("summary.priceDetails")}
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("summary.servicePrice")}</span>
            <span className="text-foreground">
              {t("common.rupees", { amount: service.price })}
            </span>
          </div>
          {discount > 0 && (
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("coupon.discount")}</span>
              <span className="font-bold text-primary">
                −{t("common.rupees", { amount: Math.round(discount) })}
              </span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("summary.gst", { percent: gstPercent })}</span>
            <span className="text-foreground">
              {t("common.rupees", { amount: tax })}
            </span>
          </div>
          {bill.roundOff !== 0 && (
            <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
              <span>{t("summary.roundOff")}</span>
              <span className="text-foreground">
                {bill.roundOff > 0 ? "+" : "−"}
                {t("common.rupees", { amount: Math.abs(bill.roundOff).toFixed(2) })}
              </span>
            </div>
          )}
          <div className="my-4 h-px bg-border" />

          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-foreground">{t("common.total")}</span>
            <span className="text-base font-bold text-foreground">
              {t("common.rupees", { amount: total })}
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
              {t("common.rupees", { amount: total })}
            </span>
          </div>
          <Button
            type="button"
            onClick={() => { void hapticImpact("medium"); onProceedToPay(); }}
            className="h-auto flex-1 rounded-[14px] px-4 py-3.5 text-sm font-bold active:scale-[0.99]"
          >
            {t("summary.proceedToPay")}
          </Button>
        </div>
      </div>
    </main>
  );
}
