import { ShoppingCart } from "lucide-react";
import { useT } from "@/i18n";
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
  const { count, total } = useStoreCart();

  if (disabled) return <StoreOrderingBar aboveNav={aboveNav} />;
  if (count === 0) return null;

  // Above-nav cart must clear the raised centre "Send Parcel" button.
  const bottom = aboveNav
    ? "bottom-[calc(var(--app-safe-bottom,0px)+98px)]"
    : "bottom-[calc(var(--app-safe-bottom,0px)+16px)]";

  return (
    <div className={`fixed inset-x-0 z-40 px-5 ${bottom}`}>
      <button
        type="button"
        onClick={onOpenCart}
        className="mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-[18px] bg-primary px-4 py-3.5 text-primary-foreground shadow-lg transition active:scale-[0.99]"
      >
        <span className="flex items-center gap-2 text-sm font-bold">
          <ShoppingCart className="h-4 w-4" />
          {t("store.cartCount", { count: String(count) })} · ₹{total.toFixed(0)}
        </span>
        <span className="text-sm font-extrabold">{t("store.viewCart")} →</span>
      </button>
    </div>
  );
}
