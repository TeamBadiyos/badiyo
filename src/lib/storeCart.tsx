/**
 * Shopping cart for the Store and Food tabs.
 *
 * One cart at a time (the Blinkit/Swiggy rule): adding an item from another
 * shop asks the customer first and then starts a fresh cart. Lines are keyed
 * by item + variant + add-ons so "Half" and "Full" sit on separate lines.
 * The cart is mirrored into localStorage so a reload doesn't lose it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PublicStore } from "@/lib/store";

export type CartAddon = { id: string; name: string; price: number };

export type CartLine = {
  /** Unique per item + variant + add-ons. Equals product_id for plain items. */
  key: string;
  product_id: string;
  name: string;
  /** Unit price including variant and add-ons. */
  price: number;
  unit: string | null;
  photo_url: string | null;
  quantity: number;
  variant_id?: string | null;
  variant_name?: string | null;
  addons?: CartAddon[];
};

export type CartState = {
  merchantId: string | null;
  storeName: string | null;
  service?: "store" | "food";
  lines: CartLine[];
};

/** Minimal item shape the cart needs (old PublicProduct and new item cards both fit). */
export type CartItemInput = {
  id: string;
  name: string;
  price: number | string;
  unit?: string | null;
  size?: string | null;
  photo_url?: string | null;
};

export type CartOptions = {
  variant?: { id: string; name: string; price: number } | null;
  addons?: CartAddon[];
};

export type CartStoreRef = { id: string; name: string | null; service?: "store" | "food" };

const EMPTY: CartState = { merchantId: null, storeName: null, lines: [] };
const KEY = "badiyos.store.cart.v1";
const MAX_QTY = 20;

function load(): CartState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as CartState;
    if (!parsed || !Array.isArray(parsed.lines)) return EMPTY;
    return { ...parsed, lines: parsed.lines.map((l) => ({ ...l, key: l.key ?? l.product_id })) };
  } catch {
    return EMPTY;
  }
}

export function lineKey(productId: string, opts?: CartOptions): string {
  const v = opts?.variant?.id ?? "";
  const a = (opts?.addons ?? []).map((x) => x.id).sort().join(",");
  return v || a ? `${productId}|${v}|${a}` : productId;
}

function toLine(p: CartItemInput, opts?: CartOptions): CartLine {
  const base = opts?.variant ? Number(opts.variant.price) : Number(p.price);
  const add = (opts?.addons ?? []).reduce((n, a) => n + Number(a.price), 0);
  return {
    key: lineKey(p.id, opts),
    product_id: p.id,
    name: p.name,
    price: base + add,
    unit: p.unit ?? p.size ?? null,
    photo_url: p.photo_url ?? null,
    quantity: 1,
    variant_id: opts?.variant?.id ?? null,
    variant_name: opts?.variant?.name ?? null,
    addons: opts?.addons ?? [],
  };
}

type CartApi = {
  cart: CartState;
  count: number;
  total: number;
  /** Total quantity of an item across all its variant/add-on lines. */
  quantityOf: (productId: string) => number;
  /** Returns false when the item belongs to another shop and needs a confirm. */
  add: (store: CartStoreRef, product: CartItemInput, opts?: CartOptions) => boolean;
  /** Empties the cart first, then adds. Used after the customer confirms. */
  replaceWith: (store: CartStoreRef, product: CartItemInput, opts?: CartOptions) => void;
  /** Accepts a line key (or a product id for plain items). */
  setQuantity: (key: string, quantity: number) => void;
  /** Removes one unit from the most recently added line of this item. */
  decrement: (productId: string) => void;
  clear: () => void;
};

const Ctx = createContext<CartApi | null>(null);

export function StoreCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY);

  useEffect(() => {
    setCart(load());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (cart.lines.length === 0) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, JSON.stringify(cart));
    } catch {
      /* private mode / quota — the in-memory cart still works */
    }
  }, [cart]);

  const put = useCallback((store: CartStoreRef, p: CartItemInput, opts?: CartOptions) => {
    setCart((prev) => {
      const base =
        prev.merchantId === store.id
          ? prev
          : { merchantId: store.id, storeName: store.name, service: store.service, lines: [] as CartLine[] };
      const k = lineKey(p.id, opts);
      const existing = base.lines.find((l) => l.key === k);
      const lines = existing
        ? base.lines.map((l) => (l.key === k ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l))
        : [...base.lines, toLine(p, opts)];
      return {
        merchantId: store.id,
        storeName: store.name ?? base.storeName,
        service: store.service ?? base.service,
        lines,
      };
    });
  }, []);

  const add: CartApi["add"] = useCallback(
    (store, product, opts) => {
      if (cart.lines.length > 0 && cart.merchantId && cart.merchantId !== store.id) return false;
      put(store, product, opts);
      return true;
    },
    [cart.lines.length, cart.merchantId, put],
  );

  const replaceWith: CartApi["replaceWith"] = useCallback(
    (store, product, opts) => {
      setCart({ merchantId: store.id, storeName: store.name, service: store.service, lines: [] });
      setTimeout(() => put(store, product, opts), 0);
    },
    [put],
  );

  const setQuantity: CartApi["setQuantity"] = useCallback((key, quantity) => {
    setCart((prev) => {
      const q = Math.max(0, Math.min(MAX_QTY, Math.round(quantity)));
      const lines = prev.lines
        .map((l) => (l.key === key ? { ...l, quantity: q } : l))
        .filter((l) => l.quantity > 0);
      if (lines.length === 0) return EMPTY;
      return { ...prev, lines };
    });
  }, []);

  const decrement: CartApi["decrement"] = useCallback((productId) => {
    setCart((prev) => {
      const idx = [...prev.lines].reverse().findIndex((l) => l.product_id === productId);
      if (idx < 0) return prev;
      const real = prev.lines.length - 1 - idx;
      const lines = prev.lines
        .map((l, i) => (i === real ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0);
      if (lines.length === 0) return EMPTY;
      return { ...prev, lines };
    });
  }, []);

  const clear = useCallback(() => setCart(EMPTY), []);

  const value = useMemo<CartApi>(() => {
    const count = cart.lines.reduce((n, l) => n + l.quantity, 0);
    const total = cart.lines.reduce((n, l) => n + l.price * l.quantity, 0);
    return {
      cart,
      count,
      total,
      quantityOf: (id) => cart.lines.filter((l) => l.product_id === id).reduce((n, l) => n + l.quantity, 0),
      add,
      replaceWith,
      setQuantity,
      decrement,
      clear,
    };
  }, [cart, add, replaceWith, setQuantity, decrement, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStoreCart(): CartApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStoreCart must be used inside <StoreCartProvider>");
  return ctx;
}

/** Store snapshot the cart needs, derived from a full store row. */
export function cartStoreRef(store: PublicStore): CartStoreRef {
  return { id: store.id, name: store.store_name ?? null };
}
