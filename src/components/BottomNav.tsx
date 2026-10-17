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

/**
 * Floating dark pill with five tabs: Clean · Store · Food · Parcel · Rewards.
 * The selected tab grows into a white pill (icon + label); flex-grow animates the slide.
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
      className="fixed inset-x-4 z-10 mx-auto max-w-md"
      style={{ bottom: "calc(var(--app-safe-bottom, 0px) + 12px)" }}
    >
      <div className="nav-float flex h-16 w-full items-center gap-1 rounded-full bg-[var(--nav-charcoal)] px-2">
        {TABS.map(({ key, labelKey, Icon }) => {
          const on = activeKey === key;
          return (
            <button
              key={key}
              onClick={() => select(key)}
              aria-label={t(labelKey)}
              aria-current={on ? "page" : undefined}
              style={{ flexGrow: on ? 2.4 : 1 }}
              className={`flex h-12 min-w-0 basis-0 items-center justify-center gap-1.5 overflow-hidden rounded-full transition-all duration-300 ease-out active:scale-95 ${
                on ? "bg-card text-[var(--nav-active)]" : "bg-transparent text-[var(--nav-inactive)]"
              }`}
            >
              <Icon className="h-[22px] w-[22px] shrink-0" strokeWidth={on ? 2.4 : 2} />
              {on && <span className="truncate text-[13px] font-extrabold animate-fade-in">{t(labelKey)}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
