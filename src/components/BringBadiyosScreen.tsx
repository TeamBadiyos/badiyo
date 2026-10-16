import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { ensureSignedIn } from "@/lib/authGate";
import { BadiyoLogo } from "./BadiyoLogo";

type Svc = "maid" | "grocery" | "food" | "parcel";
const SERVICES: { key: Svc; emoji: string }[] = [
  { key: "maid", emoji: "🧹" },
  { key: "grocery", emoji: "🛒" },
  { key: "food", emoji: "🍱" },
  { key: "parcel", emoji: "📦" },
];

/**
 * Shown when the customer's address is outside every badiyos city.
 * Saves one Demand row per wanted service (phone comes from the signed-in account).
 */
export function BringBadiyosScreen({
  location,
  onBack,
  onChangeAddress,
  onRequireLogin,
}: {
  location: { latitude: number; longitude: number; addressText?: string | null; city?: string | null; area?: string | null };
  onBack: () => void;
  onChangeAddress?: () => void;
  onRequireLogin?: () => void;
}) {
  const t = useT();
  const city = location.city?.split(",")[0]?.trim() || t("bring.yourCity");
  const [step, setStep] = useState<"intro" | "pick" | "done">("intro");
  const [picked, setPicked] = useState<Set<Svc>>(new Set());

  const { data: waiting = 0 } = useQuery({
    queryKey: ["demand_waiting_count", city],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.rpc("demand_waiting_count" as never, { _city: city } as never);
      return Number(data ?? 0);
    },
  });

  const notify = useMutation({
    mutationFn: async () => {
      if (!(await ensureSignedIn())) {
        toast(t("bring.loginFirst"));
        throw new Error("login");
      }
      const { error } = await supabase.rpc("submit_demand_request" as never, {
        _services: SERVICES.filter((s) => picked.has(s.key)).map((s) => s.key),
        _city: city,
        _area: location.area ?? null,
        _lat: location.latitude,
        _lng: location.longitude,
        _source: "outside-city",
        _address_text: location.addressText ?? null,
      } as never);
      if (error) throw new Error(t("notServiceable.joinFailed"));
    },
    onSuccess: () => setStep("done"),
    onError: (e) => {
      if ((e as Error).message !== "login") toast.error((e as Error).message);
    },
  });

  const share = async () => {
    const text = t("bring.shareText", { city });
    try {
      if (navigator.share) await navigator.share({ text });
      else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    } catch {
      /* cancelled */
    }
  };

  return (
    <main className="min-h-dvh w-full bg-background">
      <div className="bleed-safe-top mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8">
        <div className="flex items-center justify-between pt-3">
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <BadiyoLogo variant="green" className="h-6 w-auto" />
          <span className="w-10" />
        </div>

        {step === "done" ? (
          <section className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-10 w-10" strokeWidth={3} />
            </div>
            <h1 className="mt-6 text-2xl font-extrabold leading-tight">{t("bring.done", { city })}</h1>
            <button
              onClick={share}
              className="mt-8 w-full rounded-[20px] bg-primary py-4 text-base font-extrabold text-primary-foreground shadow-soft active:scale-[0.99]"
            >
              {t("bring.share")}
            </button>
          </section>
        ) : step === "pick" ? (
          <section className="flex flex-1 flex-col pt-8">
            <h1 className="text-2xl font-extrabold">{t("bring.pick")}</h1>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {SERVICES.map((s) => {
                const on = picked.has(s.key);
                return (
                  <button
                    key={s.key}
                    onClick={() =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (n.has(s.key)) n.delete(s.key);
                        else n.add(s.key);
                        return n;
                      })
                    }
                    className={`relative flex flex-col items-center gap-2 rounded-[20px] border-2 px-3 py-6 text-base font-extrabold transition ${
                      on ? "border-primary bg-primary/10 text-primary" : "border-transparent bg-surface-soft"
                    }`}
                  >
                    <span className="text-4xl">{s.emoji}</span>
                    {t(`bring.svc.${s.key}`)}
                    {on && <Check className="absolute right-3 top-3 h-5 w-5" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
            <div className="flex-1" />
            <button
              disabled={picked.size === 0 || notify.isPending}
              onClick={() => notify.mutate()}
              className="mt-8 w-full rounded-[20px] bg-primary py-4 text-base font-extrabold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {t("bring.notify")}
            </button>
          </section>
        ) : (
          <section className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="text-7xl">🚀</div>
            <h1 className="mt-6 text-[28px] font-extrabold leading-tight">{t("bring.title", { city })}</h1>
            <p className="mt-3 text-base text-muted-foreground">{t("bring.sub")}</p>
            <button
              onClick={() => setStep("pick")}
              className="mt-10 w-full rounded-[20px] bg-primary py-4 text-base font-extrabold text-primary-foreground shadow-soft active:scale-[0.99]"
            >
              {t("bring.cta", { city })}
            </button>
            {waiting >= 20 && (
              <p className="mt-4 text-sm font-bold text-foreground">
                {t("bring.waiting", { n: String(waiting), city })}
              </p>
            )}
            {onChangeAddress && (
              <button onClick={onChangeAddress} className="mt-4 text-sm font-bold text-primary">
                {t("notServiceable.changeAddress")}
              </button>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
