import { ShoppingCart, X } from "lucide-react";
import { useLanguage, useT } from "@/i18n";
import { useStoreCart } from "@/lib/storeCart";
import { StoreOrderingBar } from "./StoreOrderingBar";

/**
 * Bottom bar on every store surface. Shows the cart once something is in it,
 * and the "ordering starts soon" placeholder only when ordering is switched off.
 */
export function CartBar({
  aboveNav = false,
  onOpenCart,
  disabled = false,
}: {
  aboveNav?: boolean;
  onOpenCart: () => void;
  /** True when ordering is not available yet — falls back to the placeholder. */
  disabled?: boolean;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const { count, total, cart, clear } = useStoreCart();

  if (disabled) return <StoreOrderingBar aboveNav={aboveNav} />;
  if (count === 0) return null;

  // Sits just above the fixed tab bar.
  const bottom = aboveNav
    ? "bottom-[calc(var(--nav-height)+8px)]"
    : "bottom-[calc(var(--app-safe-bottom,0px)+16px)]";

  return (
    <div className={`fixed inset-x-0 z-40 px-4 ${bottom}`}>
      <div className="mx-auto flex w-full max-w-md items-center gap-2">
        <button
          type="button"
          onClick={onOpenCart}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[16px] bg-primary px-4 py-3 text-primary-foreground shadow-lg transition active:scale-[0.99]"
        >
          <span className="flex min-w-0 flex-col text-left">
            <span className="flex items-center gap-1.5 text-sm font-extrabold">
              <ShoppingCart className="h-4 w-4" />
              {t("store.cartCount", { count: String(count) })} · ₹{total.toFixed(0)}
            </span>
            {cart.storeName && <span className="truncate text-[11px] opacity-90">{cart.storeName}</span>}
          </span>
          <span className="shrink-0 text-sm font-extrabold">{t("store.viewCart")} →</span>
        </button>
        <button
          type="button"
          aria-label="Clear cart"
          onClick={() => {
            if (window.confirm(lang === "mr" ? "कार्ट रिकामी करायची?" : "Clear your cart?")) clear();
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card text-foreground shadow-lg active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
