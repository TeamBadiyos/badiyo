import { Sparkles } from "lucide-react";
import { useT } from "@/i18n";
import { openPlayStore, snoozeSoftUpdate } from "@/lib/version";

/**
 * Dismissible "a newer version is available" prompt. Choosing "Later" hides it
 * for 24 hours; the hard block lives in ForceUpdateScreen instead.
 */
export function SoftUpdateDialog({
  playStoreUrl,
  onClose,
}: {
  playStoreUrl: string;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-foreground/40 px-4 pb-[calc(var(--app-safe-bottom)+16px)] backdrop-blur-[2px]">
      <div className="w-full max-w-sm animate-slide-up rounded-[22px] bg-card p-5 shadow-2xl">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <h2 className="mt-4 text-lg font-extrabold text-foreground">{t("update.softTitle")}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("update.softBody")}</p>
        <button
          type="button"
          onClick={() => openPlayStore(playStoreUrl)}
          className="mt-5 w-full rounded-[14px] bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99]"
        >
          {t("update.updateNow")}
        </button>
        <button
          type="button"
          onClick={() => {
            snoozeSoftUpdate();
            onClose();
          }}
          className="mt-2 w-full rounded-[14px] px-6 py-3 text-sm font-semibold text-muted-foreground active:scale-[0.99]"
        >
          {t("update.later")}
        </button>
      </div>
    </div>
  );
}
