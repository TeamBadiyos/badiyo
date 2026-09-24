/**
 * Shopping cart for the Store tab.
 *
 * One cart = one shop (the Blinkit/Swiggy rule): adding an item from another
 * shop asks the customer first and then starts a fresh cart. The cart lives in
 * memory and is mirrored into localStorage so a reload doesn't lose it.
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
import type { PublicProduct, PublicStore } from "@/lib/store";

export type CartLine = {
  product_id: string;
  name: string;
  price: number;
  unit: string | null;
  photo_url: string | null;
  quantity: number;
};

export type CartState = {
  merchantId: string | null;
  storeName: string | null;
  lines: CartLine[];
};

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
    return parsed;
  } catch {
    return EMPTY;
  }
}

type CartApi = {
  cart: CartState;
  count: number;
  total: number;
  quantityOf: (productId: string) => number;
  /** Returns false when the item belongs to another shop and needs a confirm. */
  add: (store: { id: string; name: string | null }, product: PublicProduct) => boolean;
  /** Empties the cart first, then adds. Used after the customer confirms. */
  replaceWith: (store: { id: string; name: string | null }, product: PublicProduct) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clear: () => void;
};

const Ctx = createContext<CartApi | null>(null);

export function StoreCartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY);

  // Hydrate after mount so server and client render the same first paint.
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

  const toLine = (p: PublicProduct): CartLine => ({
    product_id: p.id,
    name: p.name,
    price: Number(p.price),
    unit: p.unit ?? null,
    photo_url: p.photo_url ?? null,
    quantity: 1,
  });

  const put = useCallback((store: { id: string; name: string | null }, p: PublicProduct) => {
    setCart((prev) => {
      const base =
        prev.merchantId === store.id
          ? prev
          : { merchantId: store.id, storeName: store.name, lines: [] as CartLine[] };
      const existing = base.lines.find((l) => l.product_id === p.id);
      const lines = existing
        ? base.lines.map((l) =>
            l.product_id === p.id ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + 1) } : l,
          )
        : [...base.lines, toLine(p)];
      return { merchantId: store.id, storeName: store.name ?? base.storeName, lines };
    });
  }, []);

  const add: CartApi["add"] = useCallback(
    (store, product) => {
      if (cart.lines.length > 0 && cart.merchantId && cart.merchantId !== store.id) return false;
      put(store, product);
      return true;
    },
    [cart.lines.length, cart.merchantId, put],
  );

  const replaceWith: CartApi["replaceWith"] = useCallback(
    (store, product) => {
      setCart({ merchantId: store.id, storeName: store.name, lines: [] });
      // Applied on the next state update so the old shop's lines are gone first.
      setTimeout(() => put(store, product), 0);
    },
    [put],
  );

  const setQuantity: CartApi["setQuantity"] = useCallback((productId, quantity) => {
    setCart((prev) => {
      const q = Math.max(0, Math.min(MAX_QTY, Math.round(quantity)));
      const lines = prev.lines
        .map((l) => (l.product_id === productId ? { ...l, quantity: q } : l))
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
      quantityOf: (id) => cart.lines.find((l) => l.product_id === id)?.quantity ?? 0,
      add,
      replaceWith,
      setQuantity,
      clear,
    };
  }, [cart, add, replaceWith, setQuantity, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStoreCart(): CartApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStoreCart must be used inside <StoreCartProvider>");
  return ctx;
}

/** Store snapshot the cart needs, derived from a full store row. */
export function cartStoreRef(store: PublicStore): { id: string; name: string | null } {
  return { id: store.id, name: store.store_name ?? null };
}
