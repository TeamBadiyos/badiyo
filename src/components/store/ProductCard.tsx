import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { hapticImpact } from "@/lib/haptics";
import { StoreImage } from "./StoreImage";
import { useStoreCart } from "@/lib/storeCart";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PublicProduct } from "@/lib/store";

const SIZE_RE = /\s*\(([^)]+)\)\s*$/;

export function splitProductName(name: string): { title: string; size: string | null } {
  const m = name.match(SIZE_RE);
  if (!m) return { title: name, size: null };
  return { title: name.replace(SIZE_RE, "").trim() || name, size: m[1].trim() };
}

/** Fixed-size product card: name (1 line) · size · unit · price + Add/stepper. */
export function ProductCard({
  product,
  store,
  onOpen,
  fluid = false,
}: {
  product: PublicProduct;
  /** The shop this item belongs to — required for adding to the cart. */
  store?: { id: string; name: string | null };
  onOpen?: () => void;
  fluid?: boolean;
}) {
  const t = useT();
  const cart = useStoreCart();
  const [askSwitch, setAskSwitch] = useState(false);
  const out = !product.in_stock;
  const { title, size } = splitProductName(product.name);
  const mrp = product.mrp != null && Number(product.mrp) > Number(product.price) ? Number(product.mrp) : null;
  const qty = cart.quantityOf(product.id);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const add = (e: React.MouseEvent) => {
    stop(e);
    void hapticImpact("light");
    if (!store) {
      toast(t("store.orderingSoon"));
      return;
    }
    if (!cart.add(store, product)) setAskSwitch(true);
  };

  const dec = (e: React.MouseEvent) => {
    stop(e);
    void hapticImpact("light");
    cart.setQuantity(product.id, qty - 1);
  };

  const inc = (e: React.MouseEvent) => {
    stop(e);
    void hapticImpact("light");
    if (store) cart.add(store, product);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
      className={
        "flex min-h-[236px] shrink-0 snap-start flex-col rounded-[18px] border border-border bg-card p-2 text-left " +
        (fluid ? "w-full" : "w-[132px]") +
        (out ? " opacity-55" : "")
      }
    >
      <div className="rounded-[14px] bg-primary/5 p-1.5">
        <StoreImage path={product.photo_url} variant="product" alt={product.name} className="aspect-square h-auto w-full" />
      </div>
      <p className="mt-2 truncate text-[13px] font-bold leading-tight text-foreground" title={product.name}>
        {title}
      </p>
      <p className="mt-0.5 h-4 truncate text-[11px] font-semibold text-foreground/70">{size ?? ""}</p>
      <p className="h-4 truncate text-[11px] text-muted-foreground">{product.unit ?? ""}</p>
      <div className="mt-auto flex items-end justify-between gap-1">
        <div className="min-w-0">
          {mrp && <p className="text-[10px] leading-none text-muted-foreground line-through">₹{mrp.toFixed(0)}</p>}
          <p className="text-sm font-extrabold text-foreground">₹{Number(product.price).toFixed(0)}</p>
        </div>
        {out ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[9px] font-bold text-muted-foreground">
            {t("store.outOfStock")}
          </span>
        ) : qty > 0 ? (
          <div
            onClick={stop}
            className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-1 py-1 text-primary-foreground shadow-md"
          >
            <button
              type="button"
              onClick={dec}
              aria-label="-"
              className="flex h-5 w-5 items-center justify-center rounded-full active:scale-90"
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={3} />
            </button>
            <span className="min-w-4 text-center text-[12px] font-extrabold tabular-nums">{qty}</span>
            <button
              type="button"
              onClick={inc}
              aria-label="+"
              className="flex h-5 w-5 items-center justify-center rounded-full active:scale-90"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={add}
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-2.5 py-1.5 text-[11px] font-bold text-primary-foreground shadow-md transition-transform active:scale-90"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            {t("store.add")}
          </button>
        )}
      </div>

      <AlertDialog open={askSwitch} onOpenChange={setAskSwitch}>
        <AlertDialogContent onClick={stop} className="max-w-[320px] rounded-[18px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("store.switchTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("store.switchBody", { name: cart.cart.storeName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (store) cart.replaceWith(store, product);
              }}
            >
              {t("store.switchConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
