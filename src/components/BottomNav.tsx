import { Home, ClipboardList, Gift, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n";
import { hapticSelection } from "@/lib/haptics";

type TabKey = "home" | "orders" | "rewards";

type Tab = {
  key: TabKey;
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  primary?: boolean;
};

export function BottomNav({
  activeKey,
  onHome,
  onOrders,
  onRewards,
}: {
  activeKey: TabKey;
  onHome: () => void;
  onOrders: () => void;
  onRewards: () => void;
}) {
  const t = useT();
  const tabs: Tab[] = [
    { key: "home", label: t("nav.home"), Icon: Home, onClick: onHome },
    { key: "orders", label: t("nav.orders"), Icon: ClipboardList, onClick: onOrders, primary: true },
    { key: "rewards", label: t("nav.rewards"), Icon: Gift, onClick: onRewards },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card"
      style={{
        paddingBottom: "max(2px, env(safe-area-inset-bottom))",
        height: "calc(72px + env(safe-area-inset-bottom, 0px))",
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-md items-stretch justify-around px-4">
        {tabs.map(({ key, label, Icon, onClick, primary }) => {
          const isActive = activeKey === key;
          if (primary) {
            return (
              <button
                key={key}
                onClick={onClick}
                aria-label={label}
                className="relative flex flex-1 flex-col items-center justify-end pb-2"
              >
                <div
                  className={`-mt-6 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary/90 text-primary-foreground"
                  }`}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <span
                  className={`mt-1 text-[11px] font-semibold ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={key}
              onClick={onClick}
              aria-label={label}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold transition ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
