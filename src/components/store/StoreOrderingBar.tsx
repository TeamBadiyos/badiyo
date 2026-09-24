import { useT } from "@/i18n";

/** Browsing only — ordering is not wired up yet. */
export function StoreOrderingBar({ aboveNav = false }: { aboveNav?: boolean }) {
  const t = useT();
  return (
    <div
      className={
        "fixed inset-x-0 z-40 px-5 pt-4 " +
        (aboveNav
          ? "bottom-[calc(var(--app-safe-bottom,0px)+98px)]"
          : "bottom-0 bg-gradient-to-t from-background via-background to-transparent pb-[calc(env(safe-area-inset-bottom)+16px)]")
      }
    >
      <div className="mx-auto w-full max-w-md">
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-[18px] bg-muted px-4 py-3.5 text-sm font-bold text-muted-foreground shadow-card-m"
        >
          {t("store.orderingSoon")}
        </button>
      </div>
    </div>
  );
}
