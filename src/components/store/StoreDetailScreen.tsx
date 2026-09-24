import { useMemo } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { StoreImage } from "./StoreImage";
import { useStoreProducts, type PublicProduct, type PublicStore } from "@/lib/store";

/** Read-only shop page: products grouped by their category, no cart, no checkout. */
export function StoreDetailScreen({
  store,
  onBack,
}: {
  store: PublicStore;
  onBack: () => void;
}) {
  const t = useT();
  const { data: products = [], isLoading } = useStoreProducts(store.id);
  const closed = !store.is_accepting_orders;

  const groups = useMemo(() => {
    const map = new Map<string, PublicProduct[]>();
    for (const p of products) {
      const key = p.product_category?.trim() || "";
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    return Array.from(map.entries());
  }, [products]);

  return (
    <main className="min-h-screen w-full bg-background pb-32 momentum-scroll">
      <div className="mx-auto w-full max-w-md px-5 pt-2">
        <header
          className="bleed-safe-top sticky top-0 z-30 -mx-5 flex items-center gap-3 bg-background px-5 pb-3"
          style={{ "--bleed-top-extra": "16px" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label={t("common.back")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-foreground">
              {store.store_name ?? "—"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[store.category_name, store.short_address].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span
            className={
              "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold " +
              (closed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")
            }
          >
            {closed ? t("store.closed") : t("store.open")}
          </span>
        </header>

        {isLoading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : products.length === 0 ? (
          <div className="mt-6 rounded-[18px] border border-dashed border-border bg-card px-6 py-12 text-center">
            <p className="text-sm font-bold text-foreground">{t("store.emptyItems")}</p>
          </div>
        ) : (
          groups.map(([label, items]) => (
            <section key={label || "all"} className="mt-5">
              {label && (
                <h3 className="text-[13px] font-bold tracking-[-0.01em] text-muted-foreground">
                  {label}
                </h3>
              )}
              <ul className="mt-2 space-y-2.5">
                {items.map((p) => (
                  <li key={p.id}>
                    <ProductRow product={p} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {/* Browsing only for now — ordering is not wired up yet. */}
      <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-background via-background to-transparent px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-[18px] bg-muted px-4 py-3.5 text-sm font-bold text-muted-foreground"
          >
            {t("store.orderingSoon")}
          </button>
        </div>
      </div>
    </main>
  );
}

function ProductRow({ product }: { product: PublicProduct }) {
  const t = useT();
  const out = !product.in_stock;
  const mrp = product.mrp != null && Number(product.mrp) > Number(product.price) ? product.mrp : null;

  return (
    <div
      className={
        "flex items-center gap-3 rounded-[18px] border border-border bg-card p-3 " +
        (out ? "opacity-55" : "")
      }
    >
      <StoreImage path={product.photo_url} alt={product.name} className="h-14 w-14 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{product.name}</p>
        {product.unit && (
          <p className="mt-0.5 text-xs text-muted-foreground">{product.unit}</p>
        )}
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-sm font-bold text-foreground">₹{Number(product.price)}</span>
          {mrp && (
            <span className="text-xs text-muted-foreground line-through">₹{Number(mrp)}</span>
          )}
        </div>
      </div>
      {out && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          {t("store.outOfStock")}
        </span>
      )}
    </div>
  );
}
