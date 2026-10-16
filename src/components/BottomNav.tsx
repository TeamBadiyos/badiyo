import { Gift, Package, ShoppingBasket, Sparkles, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";
import { writeHomeTab, type NavTab } from "@/lib/homeTab";

const TABS: { key: NavTab; labelKey: "nav.clean" | "nav.store" | "nav.food" | "nav.parcelTab" | "nav.rewards"; Icon: LucideIcon }[] = [
  { key: "clean", labelKey: "nav.clean", Icon: Sparkles },
  { key: "store", labelKey: "nav.store", Icon: ShoppingBasket },
  { key: "food", labelKey: "nav.food", Icon: UtensilsCrossed },
  { key: "parcel", labelKey: "nav.parcelTab", Icon: Package },
  { key: "rewards", labelKey: "nav.rewards", Icon: Gift },
];

/**
 * Five main tabs: Clean · Store · Food · Parcel · Rewards.
 * Clean/Store/Food live inside Home; `onHome(tab)` opens Home on that tab.
 */
export function BottomNav({
  activeKey,
  onHome,
  onRewards,
  onParcel,
}: {
  activeKey: NavTab | null;
  onHome: (tab: "clean" | "store" | "food") => void;
  onRewards: () => void;
  onParcel?: () => void;
}) {
  const t = useT();
  const select = (key: NavTab) => {
    void hapticSelection();
    if (key === "rewards") return onRewards();
    if (key === "parcel") return onParcel?.();
    writeHomeTab(key);
    onHome(key);
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border/70 bg-card shadow-nav"
      style={{
        paddingBottom: "max(2px, var(--app-safe-bottom))",
        height: "calc(70px + var(--app-safe-bottom))",
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-md items-stretch justify-around px-1">
        {TABS.map(({ key, labelKey, Icon }) => {
          const isActive = activeKey === key;
          return (
            <button
              key={key}
              onClick={() => select(key)}
              aria-label={t(labelKey)}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-[3px] text-[11px] font-bold transition ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span
                className={`flex h-9 w-[52px] items-center justify-center rounded-full transition ${
                  isActive ? "bg-primary shadow-soft" : "bg-transparent"
                }`}
              >
                <Icon
                  className={`h-[26px] w-[26px] ${isActive ? "text-primary-foreground" : ""}`}
                  strokeWidth={isActive ? 2.3 : 1.9}
                />
              </span>
              {t(labelKey)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
