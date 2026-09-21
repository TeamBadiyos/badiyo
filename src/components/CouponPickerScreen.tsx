import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Gift, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import {
  couponValueLabel,
  fetchMyCoupons,
  previewCoupon,
  type AppliedCoupon,
  type CouponPreview,
  type MyCoupon,
} from "@/lib/coupons";
import type { SelectedService } from "./SlotSelectionScreen";

type EvaluatedCoupon = {
  coupon: MyCoupon;
  result: CouponPreview;
};

async function evaluateCoupons(service: SelectedService): Promise<EvaluatedCoupon[]> {
  const coupons = await fetchMyCoupons({ throwOnError: true });
  return Promise.all(
    coupons.map(async (coupon) => ({
      coupon,
      result: await previewCoupon(
        coupon.code,
        Number(service.price),
        service.duration_minutes,
      ),
    })),
  );
}

function CouponRow({
  entry,
  applyingCode,
  appliedCode,
  onApply,
}: {
  entry: EvaluatedCoupon;
  applyingCode: string | null;
  appliedCode: string | null;
  onApply: (code: string) => void;
}) {
  const t = useT();
  const { coupon, result } = entry;
  const available = result.ok;
  const isApplied = appliedCode === coupon.code;
  const isApplying = applyingCode === coupon.code;

  return (
    <article className="border-b border-border py-5 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          {isApplied ? (
            <Check className="h-5 w-5 text-primary" />
          ) : (
            <Gift className="h-5 w-5 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{coupon.title || couponValueLabel(coupon)}</p>
          {available ? (
            <p className="mt-1 text-xs font-semibold text-primary">
              {t("coupon.saveAmount", { amount: result.coupon.discount.toFixed(2) })}
            </p>
          ) : (
            <p className="mt-1 text-xs font-medium text-destructive">{result.message}</p>
          )}
          <span className="mt-3 inline-flex rounded bg-muted px-2 py-1 text-[11px] font-extrabold uppercase text-muted-foreground">
            {coupon.code}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant={isApplied ? "secondary" : "ghost"}
          disabled={!available || isApplying || isApplied}
          onClick={() => onApply(coupon.code)}
          className="shrink-0 text-primary"
        >
          {isApplying ? t("coupon.applying") : isApplied ? t("coupon.applied") : t("coupon.apply")}
        </Button>
      </div>
    </article>
  );
}

export function CouponPickerScreen({
  service,
  appliedCoupon,
  onBack,
  onApplied,
}: {
  service: SelectedService;
  appliedCoupon: AppliedCoupon | null;
  onBack: () => void;
  onApplied: (coupon: AppliedCoupon) => void;
}) {
  const t = useT();
  const [codeInput, setCodeInput] = useState("");
  const [applyingCode, setApplyingCode] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["checkout-coupons", service.id, service.price, service.duration_minutes],
    queryFn: () => evaluateCoupons(service),
    staleTime: 60_000,
  });

  const { applicable, unavailable } = useMemo(() => {
    const entries = data ?? [];
    return {
      applicable: entries.filter((entry) => entry.result.ok),
      unavailable: entries.filter((entry) => !entry.result.ok),
    };
  }, [data]);

  async function apply(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setApplyingCode(normalized);
    setCouponError(null);
    const result = await previewCoupon(
      normalized,
      Number(service.price),
      service.duration_minutes,
    );
    setApplyingCode(null);
    if (!result.ok) {
      setCouponError(result.message);
      return;
    }
    onApplied(result.coupon);
  }

  return (
    <main className="min-h-screen w-full bg-background pb-8 app-safe-shell">
      <div className="mx-auto w-full max-w-md">
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 pb-4 pt-5 backdrop-blur">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" onClick={onBack} aria-label={t("common.back")} className="rounded-full">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-extrabold text-foreground">{t("coupon.title")}</h1>
          </div>
          <div className="mt-5 flex gap-2">
            <input
              value={codeInput}
              onChange={(event) => {
                setCodeInput(event.target.value.toUpperCase());
                setCouponError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void apply(codeInput);
              }}
              placeholder={t("coupon.enterCode")}
              autoCapitalize="characters"
              className="h-12 min-w-0 flex-1 rounded-lg border border-border bg-muted px-4 text-sm font-bold uppercase text-foreground outline-none placeholder:font-medium placeholder:normal-case focus:border-primary focus:bg-card"
            />
            <Button
              type="button"
              disabled={!codeInput.trim() || applyingCode !== null}
              onClick={() => void apply(codeInput)}
              className="h-12 rounded-lg px-5 font-bold"
            >
              {applyingCode === codeInput.trim().toUpperCase() ? t("coupon.applying") : t("coupon.apply")}
            </Button>
          </div>
          {couponError && <p className="mt-2 text-xs font-semibold text-destructive">{couponError}</p>}
        </header>

        <div className="px-5 py-5">
          {isLoading && (
            <div className="space-y-3" aria-label={t("coupon.loading")}>
              {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-muted" />)}
            </div>
          )}

          {isError && (
            <div className="py-12 text-center">
              <p className="text-sm font-semibold text-foreground">{t("coupon.loadError")}</p>
              <Button type="button" variant="outline" onClick={() => void refetch()} className="mt-4">
                {t("coupon.retry")}
              </Button>
            </div>
          )}

          {!isLoading && !isError && data?.length === 0 && (
            <div className="py-12 text-center">
              <Tag className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold text-foreground">{t("coupon.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("coupon.enterAnyCode")}</p>
            </div>
          )}

          {applicable.length > 0 && (
            <section>
              <h2 className="text-xs font-extrabold uppercase text-muted-foreground">{t("coupon.applicable")}</h2>
              <div className="mt-2">
                {applicable.map((entry) => (
                  <CouponRow key={entry.coupon.id} entry={entry} applyingCode={applyingCode} appliedCode={appliedCoupon?.code ?? null} onApply={(code) => void apply(code)} />
                ))}
              </div>
            </section>
          )}

          {unavailable.length > 0 && (
            <section className={applicable.length > 0 ? "mt-7" : ""}>
              <h2 className="text-xs font-extrabold uppercase text-muted-foreground">{t("coupon.more")}</h2>
              <div className="mt-2 opacity-75">
                {unavailable.map((entry) => (
                  <CouponRow key={entry.coupon.id} entry={entry} applyingCode={applyingCode} appliedCode={appliedCoupon?.code ?? null} onApply={(code) => void apply(code)} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}