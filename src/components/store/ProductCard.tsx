import { useBackHandler } from "@/lib/backHandler";
import { useState } from "react";
import { Minus, Plus, Store as StoreIcon } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
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
  closed = false,
  onOpen,
  fluid = false,
}: {
  product: PublicProduct;
  /** The shop this item belongs to — required for adding to the cart. */
  store?: { id: string; name: string | null };
  /** Shop is shut right now — items can be browsed but not added. */
  closed?: boolean;
  onOpen?: () => void;
  fluid?: boolean;
}) {
  const t = useT();
  const cart = useStoreCart();
  const [askSwitch, setAskSwitch] = useState(false);
  const [detail, setDetail] = useState(false);
  useBackHandler(detail, () => setDetail(false));
  const open = () => (onOpen ? onOpen() : setDetail(true));
  const out = !product.in_stock;
  const { title, size } = splitProductName(product.name);
  const mrp = product.mrp != null && Number(product.mrp) > Number(product.price) ? Number(product.mrp) : null;
  const qty = cart.quantityOf(product.id);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const add = (e: React.MouseEvent) => {
    stop(e);
    void hapticImpact("light");
    if (closed) {
      toast(t("store.errStoreClosed"));
      return;
    }
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
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
      className={
        "flex shrink-0 cursor-pointer snap-start flex-col rounded-[16px] border border-border bg-card p-2 text-left " +
        (fluid ? "w-full" : "w-[140px]") +
        (out ? " opacity-55" : "")
      }
    >
      <div className="overflow-hidden rounded-[12px] bg-card">
        <StoreImage path={product.photo_url} variant="product" alt={product.name} className="aspect-square h-auto w-full !object-contain !rounded-[12px]" />
      </div>
      <p className="mt-1.5 line-clamp-2 min-h-[2.1rem] text-[13px] font-bold leading-tight text-foreground" title={product.name}>
        {title}
      </p>
      <p className="truncate text-[11px] leading-tight text-muted-foreground">
        {[size, product.unit].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <div className="min-w-0 shrink-0">
          <p className="whitespace-nowrap text-[15px] font-extrabold leading-none text-foreground">₹{Number(product.price).toFixed(0)}</p>
          {mrp && <p className="mt-0.5 text-[10px] leading-none text-muted-foreground line-through">₹{mrp.toFixed(0)}</p>}
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

      <Drawer open={detail} onOpenChange={setDetail}>
        <DrawerContent onClick={stop} className="mx-auto max-h-[92vh] max-w-md rounded-t-[24px]">
          <div className="overflow-y-auto px-5 pb-6 pt-2">
            <div className="rounded-[20px] bg-primary/5 p-4">
              <StoreImage path={product.photo_url} variant="product" alt={product.name} className="mx-auto aspect-square h-auto w-full max-w-[300px]" />
            </div>
            <DrawerTitle className="mt-4 text-lg font-extrabold leading-snug text-foreground">{product.name}</DrawerTitle>
            {(size || product.unit) && (
              <span className="mt-1.5 inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                {[size, product.unit].filter(Boolean).join(" · ")}
              </span>
            )}
            <div className="mt-3 flex items-end gap-2">
              <p className="text-2xl font-extrabold text-foreground">₹{Number(product.price).toFixed(0)}</p>
              {mrp && (
                <>
                  <p className="pb-1 text-sm text-muted-foreground line-through">₹{mrp.toFixed(0)}</p>
                  <span className="mb-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
                    {Math.round(((mrp - Number(product.price)) / mrp) * 100)}% OFF
                  </span>
                </>
              )}
            </div>
            {store?.name && (
              <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-border p-3">
                <StoreIcon className="h-4 w-4 text-primary" />
                <p className="truncate text-sm font-semibold text-foreground">{store.name}</p>
              </div>
            )}
            {product.description && (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{product.description}</p>
            )}
          </div>
          <div className="border-t border-border bg-card px-5 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            {out ? (
              <p className="py-2 text-center text-sm font-bold text-muted-foreground">{t("store.outOfStock")}</p>
            ) : qty > 0 ? (
              <div className="flex h-12 items-center justify-between rounded-[14px] bg-primary px-3 text-primary-foreground">
                <button type="button" onClick={dec} aria-label="-" className="flex h-9 w-9 items-center justify-center"><Minus className="h-5 w-5" strokeWidth={3} /></button>
                <span className="text-base font-extrabold tabular-nums">{qty}</span>
                <button type="button" onClick={inc} aria-label="+" className="flex h-9 w-9 items-center justify-center"><Plus className="h-5 w-5" strokeWidth={3} /></button>
              </div>
            ) : (
              <button type="button" onClick={add} className="flex h-12 w-full items-center justify-center gap-1 rounded-[14px] bg-primary text-base font-bold text-primary-foreground active:scale-[0.98]">
                <Plus className="h-5 w-5" strokeWidth={3} />
                {t("store.add")}
              </button>
            )}
          </div>
        </DrawerContent>
      </Drawer>

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
