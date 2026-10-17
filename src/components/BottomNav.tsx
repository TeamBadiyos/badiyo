import { Gift, Package, ShoppingBasket, Sparkles, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";
import { writeHomeTab, type HomeTab, type NavTab } from "@/lib/homeTab";

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
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] transition active:scale-90 ${
                isActive ? "font-extrabold text-primary" : "font-semibold text-muted-foreground"
              }`}
            >
              <span
                className={`absolute top-0 h-[3px] w-8 rounded-b-full bg-primary transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`}
              />
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-[14px] transition-all duration-200 ${
                  isActive ? "-translate-y-0.5 bg-gradient-to-br from-primary to-primary/75 shadow-soft" : "bg-muted/70"
                }`}
              >
                <Icon
                  className={`h-[22px] w-[22px] ${isActive ? "text-primary-foreground" : "text-foreground/70"}`}
                  strokeWidth={isActive ? 2.4 : 2}
                  fill={isActive ? "currentColor" : "none"}
                  fillOpacity={isActive ? 0.2 : 0}
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
