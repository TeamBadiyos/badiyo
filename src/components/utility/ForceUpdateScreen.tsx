import { Download } from "lucide-react";
import { useT } from "@/i18n";
import { openPlayStore, PLAY_STORE_WEB_URL } from "@/lib/version";

export function ForceUpdateScreen({ playStoreUrl }: { playStoreUrl?: string }) {
  const t = useT();
  return (
    <main className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background px-6 pb-[calc(var(--app-safe-bottom)+24px)] pt-[calc(var(--app-safe-top)+24px)] text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
        <Download className="h-10 w-10 text-primary" />
      </div>
      <h1 className="mt-6 text-xl font-extrabold text-foreground">{t("update.hardTitle")}</h1>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">{t("update.hardBody")}</p>
      <button
        type="button"
        onClick={() => openPlayStore(playStoreUrl || PLAY_STORE_WEB_URL)}
        className="mt-8 rounded-[14px] bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99]"
      >
        {t("update.updateNow")}
      </button>
    </main>
  );
}
