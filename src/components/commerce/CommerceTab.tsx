import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerCityId } from "@/lib/customerCity";
import { useStoreCart } from "@/lib/storeCart";
import { hapticImpact } from "@/lib/haptics";
import { StoreImage } from "@/components/store/StoreImage";
import { OptionsSheet, STORE_COPY } from "./CommerceStoreScreen";
import type { CartOptions } from "@/lib/storeCart";
import {
  biName,
  formatKm,
  formatOpensAt,
  sortStores,
  useCommerceBanner,
  useCommerceHome,
  useCommerceSearch,
  useOrderAgain,
  type CommerceItem,
  type CommerceService,
  type CommerceStore,
} from "@/lib/commerce";

const COPY = {
  en: {
    searchStore: "Search stores and items",
    searchFood: "Search restaurants and dishes",
    pureVeg: "100% Pure Veg",
    all: "All",
    orderAgain: "Order again",
    recommended: "Recommended",
    allStores: "All stores",
    allFood: "All restaurants",
    opens: "Opens {t}",
    closedNow: "Closed right now",
    noStores: "No stores here yet",
    noMatch: "Nothing matches your search",
    added: "Added to cart",
    otherCart: "Your cart has items from another shop. Open the cart to finish or clear it first.",
    stores: "Stores",
    items: "Items",
  },
  mr: {
    searchStore: "दुकाने आणि वस्तू शोधा",
    searchFood: "रेस्टॉरंट आणि पदार्थ शोधा",
    pureVeg: "100% शुद्ध शाकाहारी",
    all: "सर्व",
    orderAgain: "पुन्हा ऑर्डर करा",
    recommended: "शिफारस केलेले",
    allStores: "सर्व दुकाने",
    allFood: "सर्व रेस्टॉरंट",
    opens: "{t} ला उघडेल",
    closedNow: "सध्या बंद",
    noStores: "इथे अजून दुकाने नाहीत",
    noMatch: "शोधाशी जुळणारे काही नाही",
    added: "कार्टमध्ये जोडले",
    otherCart: "तुमच्या कार्टमध्ये दुसऱ्या दुकानाच्या वस्तू आहेत. आधी कार्ट पूर्ण करा किंवा रिकामी करा.",
    stores: "दुकाने",
    items: "वस्तू",
  },
};

export type OpenStoreArg = { id: string; distance_km?: number | null };

export function CommerceTab({
  service,
  coords,
  onOpenStore,
  emptyFallback,
}: {
  service: CommerceService;
  coords: { lat: number; lng: number } | null;
  onOpenStore: (s: OpenStoreArg) => void;
  /** Shown when the tab has no stores at all (e.g. Food "coming soon"). */
  emptyFallback?: React.ReactNode;
}) {
  const { lang } = useLanguage();
  const c = COPY[lang];
  const cityId = useCustomerCityId();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const cart = useStoreCart();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  const { data: home, isLoading } = useCommerceHome(service, cityId, coords, categoryId);
  const { data: again } = useOrderAgain(service, signedIn);
  const { data: banner } = useCommerceBanner(service, cityId);

  const stores = useMemo(() => sortStores(home?.stores ?? []), [home?.stores]);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  const query = q.trim().toLowerCase();
  const { data: found, isFetching: searching } = useCommerceSearch(service, cityId, debounced, coords);
  const [sheet, setSheet] = useState<{ item: CommerceItem; store: CommerceStore } | null>(null);

  const addFound = (it: CommerceItem, s: CommerceStore, opts?: CartOptions) => {
    if (!s.is_open) {
      const when = formatOpensAt(s.next_open_at, lang);
      toast(when ? c.opens.replace("{t}", when) : c.closedNow);
      return;
    }
    if (!opts && (it.variants.length > 0 || it.addon_groups.length > 0)) {
      setSheet({ item: it, store: s });
      return;
    }
    void hapticImpact("light");
    const ok = cart.add({ id: s.id, name: s.name, service }, it, opts);
    if (ok) toast.success(c.added);
    else toast(c.otherCart);
  };

  const tapStore = (s: CommerceStore) => {
    if (!s.is_open) {
      const when = formatOpensAt(s.next_open_at, lang);
      toast(when ? c.opens.replace("{t}", when) : c.closedNow);
    }
    onOpenStore({ id: s.id, distance_km: s.distance_km ?? null });
  };

  const addAgain = (it: CommerceItem) => {
    if (!it.store_id) return;
    if (it.variants.length > 0 || it.addon_groups.length > 0 || !it.in_stock) {
      onOpenStore({ id: it.store_id });
      return;
    }
    void hapticImpact("light");
    const ok = cart.add({ id: it.store_id, name: it.store_name ?? null, service }, it);
    if (ok) toast.success(c.added);
    else toast(c.otherCart);
  };

  if (!isLoading && !categoryId && (home?.stores.length ?? 0) === 0 && emptyFallback) {
    return <>{emptyFallback}</>;
  }

  const recommended = (home?.recommended ?? []).slice(0, 6);
  const againItems = signedIn ? again?.items ?? [] : [];
  const againStores = signedIn ? again?.stores ?? [] : [];

  return (
    <div className="pb-4">
      <div className="mt-1 flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-2.5 shadow-sm">
        <Search className="h-5 w-5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
          placeholder={service === "food" ? c.searchFood : c.searchStore}
        />
      </div>

      {service === "food" && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-extrabold text-primary">
          🟢 {c.pureVeg}
        </div>
      )}

      {(home?.categories.length ?? 0) > 0 && (
        <div className="-mx-5 mt-4 flex gap-3 overflow-x-auto px-5 pb-1 no-scrollbar">
          <CategoryChip label={c.all} active={!categoryId} onClick={() => setCategoryId(null)} />
          {home!.categories.map((cat) => (
            <CategoryChip
              key={cat.id}
              label={biName(cat, lang)}
              icon={cat.icon_url}
              active={categoryId === cat.id}
              onClick={() => setCategoryId(categoryId === cat.id ? null : cat.id)}
            />
          ))}
        </div>
      )}

      {banner?.image_path && (
        <div className="mt-4 overflow-hidden rounded-[16px]">
          <StoreImage path={banner.image_path} variant="category" alt={banner.title ?? ""} size="full" className="h-24 w-full" />
        </div>
      )}

      {!query && (againItems.length > 0 || againStores.length > 0) && (
        <section className="mt-5">
          <h2 className="flex items-center gap-1.5 text-base font-extrabold text-foreground">
            <RotateCcw className="h-4 w-4 text-primary" /> {c.orderAgain}
          </h2>
          <div className="-mx-5 mt-2 flex gap-3 overflow-x-auto px-5 pb-1 no-scrollbar">
            {againItems.map((it) => (
              <button
                key={`i-${it.id}`}
                onClick={() => addAgain(it)}
                className="w-28 shrink-0 rounded-[14px] border border-border bg-card p-2 text-left active:scale-[0.98]"
              >
                <StoreImage path={it.photo_url} alt={it.name} className="h-20 w-full rounded-[10px]" />
                <p className="mt-1.5 line-clamp-2 text-[12px] font-bold leading-tight text-foreground">{it.name}</p>
                <p className="mt-0.5 text-[12px] font-extrabold text-foreground">₹{Number(it.price).toFixed(0)}</p>
                <span className="mt-1 block rounded-full bg-primary/10 py-1 text-center text-[11px] font-extrabold text-primary">+ Add</span>
              </button>
            ))}
            {againStores.map((s) => (
              <button
                key={`s-${s.id}`}
                onClick={() => tapStore(s)}
                className={`w-28 shrink-0 rounded-[14px] border border-border bg-card p-2 text-left active:scale-[0.98] ${s.is_open ? "" : "opacity-50 grayscale"}`}
              >
                <StoreImage path={s.photo_url} variant="store" alt={s.name} className="h-20 w-full rounded-[10px]" />
                <p className="mt-1.5 line-clamp-2 text-[12px] font-bold leading-tight text-foreground">{s.name}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {!query && recommended.length > 0 && (
        <section className="mt-5">
          <h2 className="text-base font-extrabold text-foreground">{c.recommended}</h2>
          <div className="mt-2 space-y-2.5">
            {recommended.map((s) => (
              <StoreCard key={`r-${s.id}`} store={s} lang={lang} onClick={() => tapStore(s)} />
            ))}
          </div>
        </section>
      )}

      {query ? (
        <SearchResults
          data={found}
          loading={searching && !found}
          lang={lang}
          c={c}
          cart={cart}
          onStore={tapStore}
          onAdd={addFound}
        />
      ) : (
      <section className="mt-5">
        <h2 className="text-base font-extrabold text-foreground">{service === "food" ? c.allFood : c.allStores}</h2>
        {isLoading && !home ? (
          <div className="mt-2 space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-[18px] bg-muted" />
            ))}
          </div>
        ) : stores.length === 0 ? (
          <p className="mt-3 rounded-[16px] border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {c.noStores}
          </p>
        ) : (
          <div className="mt-2 space-y-2.5">
            {stores.map((s) => (
              <StoreCard key={s.id} store={s} lang={lang} onClick={() => tapStore(s)} />
            ))}
          </div>
        )}
      </section>
      )}
      {sheet && (
        <OptionsSheet
          item={sheet.item}
          lang={lang}
          c={STORE_COPY[lang]}
          onClose={() => setSheet(null)}
          onConfirm={(opts) => {
            addFound(sheet.item, sheet.store, opts);
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryChip({ label, icon, active, onClick }: { label: string; icon?: string | null; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-[68px] shrink-0 flex-col items-center gap-1">
      <span
        className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] border-2 bg-card ${active ? "border-primary" : "border-transparent shadow-sm"}`}
      >
        {icon ? (
          <img src={icon} alt="" className="h-10 w-10 object-contain" loading="lazy" decoding="async" />
        ) : (
          <span className="text-lg font-extrabold text-primary">{label.slice(0, 1)}</span>
        )}
      </span>
      <span className={`line-clamp-2 text-center text-[11px] leading-tight ${active ? "font-extrabold text-primary" : "font-semibold text-foreground"}`}>
        {label}
      </span>
    </button>
  );
}

function StoreCard({ store, lang, onClick }: { store: CommerceStore; lang: string; onClick: () => void }) {
  const km = formatKm(store.distance_km);
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[18px] border border-border bg-card p-2.5 text-left transition active:scale-[0.99] ${store.is_open ? "" : "opacity-50 grayscale"}`}
    >
      <StoreImage path={store.photo_url} variant="store" alt={store.name} className="h-20 w-20 shrink-0 rounded-[14px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-extrabold text-foreground">{store.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[biName(store.store_type, lang), km].filter(Boolean).join(" · ")}
        </p>
        {store.rating != null && (
          <p className="mt-1 flex items-center gap-1 text-xs font-bold text-foreground">
            <Star className="h-3.5 w-3.5 fill-primary text-primary" />
            {Number(store.rating).toFixed(1)}
            {store.rating_count ? <span className="font-normal text-muted-foreground">({store.rating_count})</span> : null}
          </p>
        )}
        {store.offer_text && <p className="mt-1 truncate text-xs font-extrabold text-primary">{store.offer_text}</p>}
      </div>
    </button>
  );
}

function SearchResults({
  data,
  loading,
  lang,
  c,
  cart,
  onStore,
  onAdd,
}: {
  data: import("@/lib/commerce").CommerceSearch | undefined;
  loading: boolean;
  lang: "en" | "mr";
  c: (typeof COPY)["en"];
  cart: ReturnType<typeof useStoreCart>;
  onStore: (s: CommerceStore) => void;
  onAdd: (it: CommerceItem, s: CommerceStore) => void;
}) {
  if (loading) {
    return (
      <div className="mt-5 space-y-2.5">
        {[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-[18px] bg-muted" />)}
      </div>
    );
  }
  const stores = data?.stores ?? [];
  const groups = data?.item_groups ?? [];
  if (stores.length === 0 && groups.length === 0) {
    return (
      <p className="mt-5 rounded-[16px] border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        {c.noMatch}
      </p>
    );
  }
  return (
    <>
      {groups.length > 0 && (
        <section className="mt-5">
          <h2 className="text-base font-extrabold text-foreground">{c.items}</h2>
          <div className="mt-2 space-y-3">
            {groups.map((g) => {
              const km = formatKm(g.store.distance_km);
              return (
                <div key={g.store.id} className={`rounded-[18px] border border-border bg-card p-3 ${g.store.is_open ? "" : "opacity-50 grayscale"}`}>
                  <button onClick={() => onStore(g.store)} className="flex w-full items-center justify-between text-left">
                    <span className="truncate text-sm font-extrabold text-foreground">{g.store.name}</span>
                    {km && <span className="shrink-0 text-xs text-muted-foreground">{km}</span>}
                  </button>
                  <div className="mt-2 divide-y divide-border">
                    {g.items.map((it) => {
                      const qty = cart.quantityOf(it.id);
                      const disabled = !g.store.is_open || !it.in_stock;
                      return (
                        <div key={it.id} className="flex items-center gap-3 py-2">
                          <StoreImage path={it.photo_url} alt={it.name} className="h-12 w-12 shrink-0 rounded-[10px]" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-bold text-foreground">{it.name}</p>
                            <p className="text-[12px] font-extrabold text-foreground">
                              ₹{Number(it.price).toFixed(0)}
                              {it.size ? <span className="ml-1 font-normal text-muted-foreground">· {it.size}</span> : null}
                            </p>
                          </div>
                          {!it.in_stock ? (
                            <span className="text-[11px] font-extrabold text-muted-foreground">{STORE_COPY[lang].out}</span>
                          ) : qty > 0 ? (
                            <div className="flex w-20 items-center justify-between rounded-[10px] bg-primary px-1 py-1 text-primary-foreground">
                              <button aria-label="-" onClick={() => cart.decrement(it.id)} className="h-6 w-6 font-extrabold">−</button>
                              <span className="text-[13px] font-extrabold tabular-nums">{qty}</span>
                              <button aria-label="+" onClick={() => onAdd(it, g.store)} className="h-6 w-6 font-extrabold">+</button>
                            </div>
                          ) : (
                            <button
                              disabled={disabled}
                              onClick={() => onAdd(it, g.store)}
                              className="w-20 rounded-[10px] border border-primary bg-card py-1.5 text-[12px] font-extrabold text-primary disabled:opacity-50"
                            >
                              + {STORE_COPY[lang].add}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {stores.length > 0 && (
        <section className="mt-5">
          <h2 className="text-base font-extrabold text-foreground">{c.stores}</h2>
          <div className="mt-2 space-y-2.5">
            {stores.map((s) => (
              <StoreCard key={s.id} store={s} lang={lang} onClick={() => onStore(s)} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
