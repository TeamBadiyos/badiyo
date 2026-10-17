import { Gift, Package, ShoppingBasket, Sparkles, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";
import { writeHomeTab, type HomeTab, type NavTab } from "@/lib/homeTab";

type LabelKey = "nav.clean" | "nav.store" | "nav.food" | "nav.parcelTab" | "nav.rewards";

const TABS: { key: NavTab; labelKey: LabelKey; Icon: LucideIcon }[] = [
  { key: "clean", labelKey: "nav.clean", Icon: Sparkles },
  { key: "store", labelKey: "nav.store", Icon: ShoppingBasket },
  { key: "food", labelKey: "nav.food", Icon: UtensilsCrossed },
  { key: "parcel", labelKey: "nav.parcelTab", Icon: Package },
  { key: "rewards", labelKey: "nav.rewards", Icon: Gift },
];

/** Blinkit-style fixed white bottom bar: icon + label, green top indicator on the selected tab. */
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--nav-border)] bg-card"
      style={{ paddingBottom: "var(--app-safe-bottom, 0px)" }}
    >
      <div className="mx-auto flex h-16 w-full max-w-md">
        {TABS.map(({ key, labelKey, Icon }) => {
          const on = activeKey === key;
          return (
            <button
              key={key}
              onClick={() => select(key)}
              aria-current={on ? "page" : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150 ${
                on ? "text-[var(--nav-active)]" : "text-[var(--nav-inactive)]"
              }`}
            >
              {on && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-[var(--nav-active)]" />}
              <Icon className="h-6 w-6" strokeWidth={2} />
              <span className={`truncate text-[12px] leading-none ${on ? "font-bold" : "font-medium"}`}>{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
