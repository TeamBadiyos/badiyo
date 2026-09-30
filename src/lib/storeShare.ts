/**
 * Store sharing: every shop has a readable custom link
 * (https://user.badiyos.com/store/<store_slug>) that a merchant can send on
 * WhatsApp. Opening that link lands the customer straight inside that shop.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PublicStore } from "@/lib/store";

export const STORE_LINK_ORIGIN = "https://user.badiyos.com";

const PENDING_KEY = "badiyo.pendingStore";
/** Fired after a deep link is captured so an already-mounted Home can react. */
export const PENDING_STORE_EVENT = "badiyo:pending-store";

/** The shareable link for a shop. Falls back to the id when no custom name exists. */
export function buildStoreLink(store: Pick<PublicStore, "id" | "store_slug">): string {
  const key = (store.store_slug ?? "").trim() || store.id;
  return `${STORE_LINK_ORIGIN}/store/${key}`;
}

/** Ready-to-send Hindi WhatsApp message. The link appears exactly once. */
export function buildStoreShareMessage(store: PublicStore): string {
  const name = store.store_name?.trim() || "हमारी दुकान";
  const place = store.short_address?.trim();
  return [
    `*${name}* अब *Badiyos* पर! 🛒`,
    place ? `📍 ${place}` : "",
    "",
    "घर बैठे ऑर्डर करें और सामान सीधे आपके दरवाज़े तक। 🚚",
    "",
    "*नीचे दिए लिंक पर टैप करके दुकान खोलें:*",
    buildStoreLink(store),
    "",
    "*Badiyos — हर घर का अपना साथी 💚*",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

/** Read a store key out of the current URL: /store/<key> or ?store=<key>. */
export function readStoreKeyFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get("store");
    if (q?.trim()) return q.trim();
    const m = url.pathname.match(/\/store\/([^/?#]+)/i);
    if (m?.[1]) return decodeURIComponent(m[1]).trim();
  } catch {
    /* ignore */
  }
  return null;
}

/** Extract the store key from any deep link URL (native appUrlOpen). */
export function readStoreKeyFromLink(url: string): string | null {
  const m = url?.match(/\/store\/([^/?#]+)/i);
  if (m?.[1]) return decodeURIComponent(m[1]).trim();
  try {
    const q = new URL(url).searchParams.get("store");
    return q?.trim() || null;
  } catch {
    return null;
  }
}

/** Remember the shop to open after login / app boot. */
export function storePendingStoreKey(key: string): void {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(PENDING_KEY, key);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(PENDING_STORE_EVENT, { detail: key }));
}

export function getPendingStoreKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearPendingStoreKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Capture a store key from the current URL, if any. */
export function capturePendingStoreKey(): string | null {
  const key = readStoreKeyFromUrl();
  if (key) storePendingStoreKey(key);
  return key ?? getPendingStoreKey();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Look a shop up by its custom link name (or id). Returns null when unknown. */
export async function fetchStoreByKey(key: string): Promise<PublicStore | null> {
  const clean = key.trim();
  if (!clean) return null;
  const columns =
    "id, store_name, store_slug, store_category_id, category_name, category_slug, zone_id, photo_url, short_address, lat, lng, is_accepting_orders, is_open_now, rating";
  const query = supabase.from("public_stores").select(columns);
  const { data, error } = UUID_RE.test(clean)
    ? await query.eq("id", clean).maybeSingle()
    : await query.eq("store_slug", clean.toLowerCase()).maybeSingle();
  if (error) return null;
  return (data as PublicStore | null) ?? null;
}
