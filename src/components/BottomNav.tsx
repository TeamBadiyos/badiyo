import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";
import { writeHomeTab, type HomeTab, type NavTab } from "@/lib/homeTab";

type LabelKey = "nav.clean" | "nav.store" | "nav.food" | "nav.parcelTab" | "nav.rewards";

// Pictures live in public/brand/nav so the native build works offline.
const TABS: { key: NavTab; labelKey: LabelKey; img: string; tile: string }[] = [
  { key: "clean", labelKey: "nav.clean", img: "/brand/nav/clean.webp", tile: "bg-[var(--tile-clean)]" },
  { key: "store", labelKey: "nav.store", img: "/brand/nav/store.webp", tile: "bg-[var(--tile-store)]" },
  { key: "food", labelKey: "nav.food", img: "/brand/nav/food.webp", tile: "bg-[var(--tile-food)]" },
  { key: "parcel", labelKey: "nav.parcelTab", img: "/brand/nav/parcel.webp", tile: "bg-[var(--tile-parcel)]" },
  { key: "rewards", labelKey: "nav.rewards", img: "/brand/nav/rewards.webp", tile: "bg-[var(--tile-rewards)]" },
];

/**
 * Five main tabs: Clean · Store · Food · Parcel · Rewards.
 * Clean/Store/Food/Parcel live inside Home; `onHome(tab)` opens Home on that tab.
 */
export function BottomNav({
  activeKey,
  onHome,
  onRewards,
}: {
  activeKey: NavTab | null;
  onHome: (tab: HomeTab) => void;
  onRewards: () => void;
  /** Unused: Parcel is a Home tab now. Kept so callers compile. */
  onParcel?: () => void;
}) {
  const t = useT();
  const select = (key: NavTab) => {
    void hapticSelection();
    if (key === "rewards") return onRewards();
    writeHomeTab(key);
    onHome(key);
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 px-3"
      style={{ paddingBottom: "max(8px, var(--app-safe-bottom))" }}
    >
      <div className="nav-glow mx-auto flex h-[72px] w-full max-w-md items-stretch justify-around rounded-[28px] bg-card px-1">
        {TABS.map(({ key, labelKey, img, tile }) => {
          const isActive = activeKey === key;
          return (
            <button
              key={key}
              onClick={() => select(key)}
              aria-label={t(labelKey)}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center justify-end gap-0.5 pb-2 text-[11px] transition active:scale-90 ${
                isActive ? "font-extrabold text-primary" : "font-bold text-foreground/80"
              }`}
            >
              {isActive && (
                <span className="absolute -top-4 left-1/2 h-16 w-16 -translate-x-1/2 rounded-full bg-card" aria-hidden />
              )}
              <span
                className={`relative flex items-center justify-center rounded-full transition-all duration-200 ${
                  isActive ? "-mt-6 h-14 w-14 bg-gradient-to-br from-primary to-primary/80 nav-active-glow" : `h-10 w-10 ${tile}`
                }`}
              >
                <img
                  src={img}
                  alt=""
                  draggable={false}
                  className={isActive ? "h-9 w-9 object-contain" : "h-7 w-7 object-contain"}
                />
              </span>
              <span className="relative">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
