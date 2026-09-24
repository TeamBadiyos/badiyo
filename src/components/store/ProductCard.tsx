import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { hapticImpact } from "@/lib/haptics";
import { StoreImage } from "./StoreImage";
import type { PublicProduct } from "@/lib/store";

const SIZE_RE = /\s*\(([^)]+)\)\s*$/;

export function splitProductName(name: string): { title: string; size: string | null } {
  const m = name.match(SIZE_RE);
  if (!m) return { title: name, size: null };
  return { title: name.replace(SIZE_RE, "").trim() || name, size: m[1].trim() };
}

/** Fixed-size product card: name (1 line) · size · unit · price + Add. */
export function ProductCard({
  product,
  onOpen,
  fluid = false,
}: {
  product: PublicProduct;
  onOpen?: () => void;
  fluid?: boolean;
}) {
  const t = useT();
  const out = !product.in_stock;
  const { title, size } = splitProductName(product.name);
  const mrp = product.mrp != null && Number(product.mrp) > Number(product.price) ? Number(product.mrp) : null;

  const add = (e: React.MouseEvent) => {
    e.stopPropagation();
    void hapticImpact("light");
    toast(t("store.orderingSoon"));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
      className={
        "flex h-[236px] shrink-0 snap-start flex-col rounded-[18px] border border-border bg-card p-2 text-left " +
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
    </div>
  );
}
