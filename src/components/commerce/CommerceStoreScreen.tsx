import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Minus, Plus, Search, Star, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useBackHandler } from "@/lib/backHandler";
import { getDeviceId } from "@/lib/deviceId";
import { hapticImpact } from "@/lib/haptics";
import { useStoreCart, type CartOptions, type CartStoreRef } from "@/lib/storeCart";
import { StoreImage } from "@/components/store/StoreImage";
import { CartBar } from "@/components/store/CartBar";
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
import {
  biName,
  formatKm,
  formatOpensAt,
  useStorePage,
  type CommerceItem,
  type CommerceStore,
} from "@/lib/commerce";

export const STORE_COPY = {
  en: {
    recommended: "⭐ Recommended",
    add: "Add",
    out: "Out of stock",
    opens: "Opens {t}",
    closedNow: "Closed right now",
    unavailable: "This store isn't available right now",
    switchTitle: "Start a new cart?",
    switchBody: "Your cart has items from {s}. Clear it and add this item?",
    keep: "Keep cart",
    replace: "Clear and add",
    choose: "Choose size",
    pick: "Pick {n}",
    upTo: "Up to {n}",
    addItem: "Add item · ₹{p}",
    needMin: "Please choose {n} in {g}",
    customisable: "Customisable",
    search: "Search in this store",
    menu: "Menu",
    noMatch: "No items match",
  },
  mr: {
    recommended: "⭐ शिफारस केलेले",
    add: "जोडा",
    out: "स्टॉक संपला",
    opens: "{t} ला उघडेल",
    closedNow: "सध्या बंद",
    unavailable: "हे दुकान सध्या उपलब्ध नाही",
    switchTitle: "नवीन कार्ट सुरू करायची?",
    switchBody: "तुमच्या कार्टमध्ये {s} च्या वस्तू आहेत. कार्ट रिकामी करून ही वस्तू जोडायची?",
    keep: "कार्ट ठेवा",
    replace: "रिकामी करून जोडा",
    choose: "आकार निवडा",
    pick: "{n} निवडा",
    upTo: "जास्तीत जास्त {n}",
    addItem: "वस्तू जोडा · ₹{p}",
    needMin: "{g} मध्ये {n} निवडा",
    customisable: "बदल करता येते",
    search: "या दुकानात शोधा",
    menu: "मेनू",
    noMatch: "जुळणारी वस्तू नाही",
  },
};

export function CommerceStoreScreen({
  storeId,
  distanceKm,
  onBack,
  onOpenCart,
  orderingEnabled,
  source = "browse",
}: {
  storeId: string;
  distanceKm?: number | null;
  onBack: () => void;
  onOpenCart: () => void;
  orderingEnabled: boolean;
  source?: "browse" | "search" | "link" | "banner";
}) {
  useBackHandler(true, () => onBack());
  const { lang } = useLanguage();
  const c = STORE_COPY[lang];
  const cart = useStoreCart();
  const { data, isLoading } = useStorePage(storeId);
  const [sheetItem, setSheetItem] = useState<CommerceItem | null>(null);
  const [pending, setPending] = useState<null | { item: CommerceItem; opts?: CartOptions }>(null);
  useBackHandler(!!sheetItem, () => setSheetItem(null));
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  useBackHandler(menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    void (async () => {
      try {
        const sessionId = await getDeviceId();
        await supabase.rpc("record_merchant_store_visit", { _merchant_id: storeId, _session_id: sessionId, _source: source });
      } catch {
        /* analytics must never break the store page */
      }
    })();
  }, [storeId]);

  const store = data?.store ?? null;
  const isFood = store?.service_type === "food";
  const closed = store ? !store.is_open : false;
  const canAdd = !closed && orderingEnabled;
  const ref: CartStoreRef | null = store ? { id: store.id, name: store.name, service: isFood ? "food" : "store" } : null;

  const menu = useMemo(
    () =>
      (data?.menu ?? []).map((g) => ({
        ...g,
        items: [...g.items].sort((a, b) => Number(b.in_stock) - Number(a.in_stock)),
      })),
    [data?.menu],
  );
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? menu
        .map((g) => ({ ...g, items: g.items.filter((it) => { const h = `${it.name} ${it.description ?? ""}`.toLowerCase(); return words.every((w) => h.includes(w)); }) }))
        .filter((g) => g.items.length > 0)
    : menu;
  const jump = (i: number) => {
    setMenuOpen(false);
    document.getElementById(`cat-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const opensText = () => {
    const when = formatOpensAt(store?.next_open_at ?? null, lang);
    return when ? c.opens.replace("{t}", when) : c.closedNow;
  };

  const tryAdd = (item: CommerceItem, opts?: CartOptions) => {
    if (!ref) return;
    if (!canAdd) {
      toast(closed ? opensText() : c.unavailable);
      return;
    }
    void hapticImpact("light");
    if (!cart.add(ref, item, opts)) setPending({ item, opts });
  };

  const onAdd = (item: CommerceItem) => {
    if (!canAdd) return tryAdd(item);
    if (item.variants.length > 0 || item.addon_groups.length > 0) setSheetItem(item);
    else tryAdd(item);
  };

  if (isLoading) {
    return (
      <div className="min-h-dvh space-y-3 bg-background p-4">
        <div className="h-44 animate-pulse rounded-[18px] bg-muted" />
        <div className="h-24 animate-pulse rounded-[18px] bg-muted" />
      </div>
    );
  }
  if (!store) {
    return (
      <main className="min-h-dvh bg-background px-5 pt-[calc(var(--app-safe-top,0px)+16px)]">
        <BackBtn onBack={onBack} />
        <p className="mt-10 text-center text-sm text-muted-foreground">{c.unavailable}</p>
      </main>
    );
  }

  const km = formatKm(distanceKm ?? store.distance_km ?? null);
  const recommended = (data?.recommended ?? []).slice(0, 6);
  const props = { lang, c, cart, canAdd, onAdd, onDec: (id: string) => cart.decrement(id) };

  return (
    <main className="min-h-screen w-full bg-background pb-32 momentum-scroll">
      <div className="relative mx-auto w-full max-w-md">
        <div className={`relative h-52 w-full overflow-hidden ${closed ? "grayscale" : ""}`}>
          <StoreImage path={store.photo_url} variant="store" alt={store.name} size="full" className="h-full w-full" />
          <div className="absolute inset-x-0 top-0 px-4 pt-[calc(var(--app-safe-top,0px)+12px)]">
            <BackBtn onBack={onBack} />
          </div>
        </div>
        <div className={`relative -mt-6 rounded-t-[24px] bg-background px-5 pt-4 ${closed ? "opacity-60 grayscale" : ""}`}>
          <h1 className="text-xl font-extrabold text-foreground">{store.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[biName(store.store_type, lang), km].filter(Boolean).join(" · ")}
          </p>
          {store.rating != null && (
            <p className="mt-1 flex items-center gap-1 text-sm font-bold text-foreground">
              <Star className="h-4 w-4 fill-primary text-primary" />
              {Number(store.rating).toFixed(1)}
              {store.rating_count ? <span className="font-normal text-muted-foreground">({store.rating_count})</span> : null}
            </p>
          )}
          {store.offer_text && <p className="mt-1 text-sm font-extrabold text-primary">{store.offer_text}</p>}
        </div>
        {closed && (
          <div className="mx-5 mt-3 rounded-[14px] bg-muted px-4 py-2.5 text-center text-sm font-extrabold text-foreground">
            {opensText()}
          </div>
        )}

        <div className="sticky top-0 z-20 bg-background px-5 pb-2 pt-[calc(var(--app-safe-top,0px)+8px)]">
          <label className="flex items-center gap-2 rounded-[14px] border border-border bg-card px-3.5 py-2.5 shadow-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.search} className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            {q && <button type="button" aria-label="Clear" onClick={() => setQ("")}><X className="h-4 w-4 text-muted-foreground" /></button>}
          </label>
        </div>
        <div className={`px-5 ${closed ? "opacity-60 grayscale" : ""}`}>
          {!words.length && recommended.length > 0 && (
            <Section title={c.recommended}>
              <FoodList items={recommended} {...props} />
            </Section>
          )}
          {words.length > 0 && shown.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">{c.noMatch}</p>}
          {shown.map((g, i) => (
            <Section id={`cat-${i}`} key={g.category.id ?? `g${i}`} title={`${biName(g.category, lang)} (${g.items.length})`}>
              <FoodList items={g.items} {...props} />
            </Section>
          ))}
        </div>
      </div>

      {shown.length > 1 && (
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="fixed bottom-[calc(var(--app-safe-bottom,0px)+96px)] right-1/2 z-30 flex translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-extrabold text-background shadow-lg"
        >
          <UtensilsCrossed className="h-4 w-4" /> {c.menu}
        </button>
      )}
      {menuOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/40" onClick={() => setMenuOpen(false)}>
          <div className="mb-[calc(var(--app-safe-bottom,0px)+150px)] max-h-[60vh] w-[85%] max-w-sm overflow-y-auto rounded-[20px] bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            {shown.map((g, i) => (
              <button key={g.category.id ?? `m${i}`} type="button" onClick={() => jump(i)} className="flex w-full items-center justify-between py-2.5 text-left">
                <span className="text-[15px] font-bold text-foreground">{biName(g.category, lang)}</span>
                <span className="text-sm text-muted-foreground">{g.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <CartBar onOpenCart={onOpenCart} />

      {sheetItem && (
        <OptionsSheet
          item={sheetItem}
          lang={lang}
          c={c}
          onClose={() => setSheetItem(null)}
          onConfirm={(opts) => {
            const it = sheetItem;
            setSheetItem(null);
            tryAdd(it, opts);
          }}
        />
      )}

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{c.switchTitle}</AlertDialogTitle>
            <AlertDialogDescription>{c.switchBody.replace("{s}", cart.cart.storeName ?? "—")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.keep}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending && ref) cart.replaceWith(ref, pending.item, pending.opts);
                setPending(null);
              }}
            >
              {c.replace}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function BackBtn({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-card shadow-soft"
    >
      <ArrowLeft className="h-5 w-5 text-foreground" />
    </button>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-6 scroll-mt-20">
      <h2 className="mb-2.5 text-base font-extrabold text-primary">{title}</h2>
      {children}
    </section>
  );
}

type ItemProps = {
  items: CommerceItem[];
  lang: string;
  c: (typeof STORE_COPY)["en"];
  cart: ReturnType<typeof useStoreCart>;
  canAdd: boolean;
  onAdd: (i: CommerceItem) => void;
  onDec: (id: string) => void;
};

function Price({ item }: { item: CommerceItem }) {
  const orig = item.original_price != null && Number(item.original_price) > Number(item.price) ? Number(item.original_price) : null;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[14px] font-extrabold text-foreground">₹{Number(item.price).toFixed(0)}</span>
      {orig && <span className="text-[11px] text-muted-foreground line-through">₹{orig.toFixed(0)}</span>}
    </span>
  );
}

function AddControl({ item, c, cart, canAdd, onAdd, onDec, wide }: Omit<ItemProps, "items" | "lang"> & { item: CommerceItem; wide?: boolean }) {
  const qty = cart.quantityOf(item.id);
  if (!item.in_stock) {
    return <span className="block rounded-[10px] bg-muted py-1.5 text-center text-[11px] font-extrabold text-muted-foreground">{c.out}</span>;
  }
  if (qty > 0) {
    return (
      <div className={`flex items-center justify-between rounded-[10px] bg-primary px-1 py-1 text-primary-foreground ${wide ? "w-24" : ""}`}>
        <button type="button" aria-label="-" onClick={() => onDec(item.id)} className="flex h-6 w-6 items-center justify-center">
          <Minus className="h-3.5 w-3.5" strokeWidth={3} />
        </button>
        <span className="text-[13px] font-extrabold tabular-nums">{qty}</span>
        <button type="button" aria-label="+" onClick={() => onAdd(item)} className="flex h-6 w-6 items-center justify-center">
          <Plus className="h-3.5 w-3.5" strokeWidth={3} />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onAdd(item)}
      disabled={!canAdd}
      className={`rounded-[10px] border border-primary bg-card py-1.5 text-[12px] font-extrabold text-primary shadow-sm disabled:opacity-50 ${wide ? "w-24" : "w-full"}`}
    >
      + {c.add}
    </button>
  );
}


function ItemDesc({ text, lang }: { text: string; lang: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 80;
  return (
    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
      {open || !long ? text : `${text.slice(0, 80).trimEnd()}…`}
      {long && (
        <button type="button" onClick={() => setOpen(!open)} className="ml-1 font-extrabold text-foreground">
          {open ? (lang === "mr" ? "कमी दाखवा" : "less") : lang === "mr" ? "अधिक पहा" : "more"}
        </button>
      )}
    </p>
  );
}

function FoodList({ items, ...rest }: ItemProps) {
  return (
    <div className="divide-y divide-dashed divide-border">
      {items.map((it) => (
        <div key={it.id} className={`flex gap-3 py-4 ${it.in_stock ? "" : "opacity-50 grayscale"}`}>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-extrabold leading-snug text-foreground">{it.name}</p>
            {it.size && <p className="text-[12px] text-muted-foreground">{it.size}</p>}
            <div className="mt-1">
              <Price item={it} />
            </div>
            {it.description && <ItemDesc text={it.description} lang={rest.lang} />}
          </div>
          <div className="flex w-[118px] shrink-0 flex-col items-center">
            {it.photo_url ? <StoreImage path={it.photo_url} alt={it.name} className="h-[110px] w-[118px] rounded-[16px]" /> : null}
            <div className={it.photo_url ? "-mt-4" : "mt-2"}>
              <AddControl item={it} {...rest} wide />
            </div>
            {(it.variants.length > 0 || it.addon_groups.length > 0) && it.in_stock && (
              <span className="mt-1 text-[10px] text-muted-foreground">{rest.c.customisable}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OptionsSheet({
  item,
  c,
  onClose,
  onConfirm,
}: {
  item: CommerceItem;
  lang: string;
  c: (typeof STORE_COPY)["en"];
  onClose: () => void;
  onConfirm: (opts: CartOptions) => void;
}) {
  const def = item.variants.find((v) => v.is_default) ?? item.variants[0] ?? null;
  const [variantId, setVariantId] = useState<string | null>(def?.id ?? null);
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const addons = item.addon_groups.flatMap((g) => g.options.filter((o) => (picked[g.name] ?? []).includes(o.id)));
  const total = (variant ? Number(variant.price) : Number(item.price)) + addons.reduce((n, a) => n + Number(a.price), 0);

  const toggle = (group: string, id: string, max: number | null) => {
    setPicked((p) => {
      const cur = p[group] ?? [];
      if (cur.includes(id)) return { ...p, [group]: cur.filter((x) => x !== id) };
      if (max === 1) return { ...p, [group]: [id] };
      if (max != null && cur.length >= max) return p;
      return { ...p, [group]: [...cur, id] };
    });
  };

  const confirm = () => {
    for (const g of item.addon_groups) {
      const n = (picked[g.name] ?? []).length;
      if (n < (g.min ?? 0)) {
        toast(c.needMin.replace("{n}", String(g.min)).replace("{g}", g.name));
        return;
      }
    }
    onConfirm({
      variant: variant ? { id: variant.id, name: variant.name, price: Number(variant.price) } : null,
      addons: addons.map((a) => ({ id: a.id, name: a.name, price: Number(a.price) })),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-foreground/40" onClick={onClose}>
      <div
        className="mx-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] bg-background px-5 pb-[calc(var(--app-safe-bottom,0px)+16px)] pt-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-lg font-extrabold text-foreground">{item.name}</p>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {item.variants.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-extrabold text-foreground">{c.choose}</p>
            <div className="mt-2 space-y-2">
              {item.variants.map((v) => (
                <OptionRow key={v.id} label={v.name} price={Number(v.price)} on={variantId === v.id} radio onClick={() => setVariantId(v.id)} />
              ))}
            </div>
          </div>
        )}

        {item.addon_groups.map((g) => (
          <div key={g.name} className="mt-4">
            <p className="text-sm font-extrabold text-foreground">
              {g.name}
              <span className="ml-2 text-xs font-semibold text-muted-foreground">
                {g.min > 0 ? c.pick.replace("{n}", String(g.min)) : g.max ? c.upTo.replace("{n}", String(g.max)) : ""}
              </span>
            </p>
            <div className="mt-2 space-y-2">
              {g.options.map((o) => (
                <OptionRow
                  key={o.id}
                  label={o.name}
                  price={Number(o.price)}
                  plus
                  on={(picked[g.name] ?? []).includes(o.id)}
                  radio={g.max === 1}
                  onClick={() => toggle(g.name, o.id, g.max)}
                />
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={confirm}
          className="mt-5 h-12 w-full rounded-[16px] bg-primary text-sm font-extrabold text-primary-foreground active:scale-[0.99]"
        >
          {c.addItem.replace("{p}", total.toFixed(0))}
        </button>
      </div>
    </div>
  );
}

function OptionRow({ label, price, on, radio, plus, onClick }: { label: string; price: number; on: boolean; radio?: boolean; plus?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-[12px] border px-3 py-2.5 text-left text-sm ${on ? "border-primary bg-primary/5" : "border-border bg-card"}`}
    >
      <span className="flex items-center gap-2.5 font-semibold text-foreground">
        <span className={`flex h-5 w-5 items-center justify-center border-2 ${radio ? "rounded-full" : "rounded-[6px]"} ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
          {on && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        {label}
      </span>
      <span className="font-bold text-foreground">{plus ? (price > 0 ? `+₹${price.toFixed(0)}` : "") : `₹${price.toFixed(0)}`}</span>
    </button>
  );
}

export type { CommerceStore };
