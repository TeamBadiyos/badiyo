import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerCityId, getCustomerCityId } from "@/lib/customerCity";
import { useGstPercent } from "@/lib/gst";
import type { ServiceState } from "@/lib/serviceHours";

/** Clean Home = 'clean', Car & Bike Wash = 'wash'. Public RPCs, city-aware. */
export type CleanServiceKey = "clean" | "wash";

const rpc = ((fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>).call(supabase, fn, args));

export function useServiceHours(key: CleanServiceKey, enabled = true) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-service-hours", key, cityId],
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ServiceState | null> => {
      const { data, error } = await rpc("app_service_hours", { _service_key: key, _city_id: cityId });
      if (error) return null; // fail-open
      return ((data as { state?: ServiceState } | null)?.state ?? null) as ServiceState | null;
    },
  });
}

export type BookNowGate = { allowed: boolean; reason: "book_now_off" | "closed" | "slot_full" | null };

export function useBookNowAllowed(key: CleanServiceKey, enabled = true) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-book-now-allowed", key, cityId],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<BookNowGate> => {
      const { data, error } = await rpc("app_book_now_allowed", { _service_key: key, _city_id: cityId });
      if (error || !data) return { allowed: true, reason: null };
      const d = data as { allowed?: boolean; reason?: BookNowGate["reason"] };
      return { allowed: d.allowed !== false, reason: d.allowed === false ? (d.reason ?? "slot_full") : null };
    },
  });
}

export async function fetchAppFullySlots(key: CleanServiceKey, from: string, to: string): Promise<Set<string>> {
  const { data, error } = await rpc("app_fully_booked_slots", { _service_key: key, _city_id: getCustomerCityId(), _from: from, _to: to });
  if (error || !Array.isArray(data)) return new Set();
  return new Set(
    (data as { slot_date: string; start_hour: number; start_minute?: number }[]).map(
      (r) => `${String(r.slot_date).slice(0, 10)}|${Number(r.start_hour) * 60 + Number(r.start_minute ?? 0)}`,
    ),
  );
}

export type BookingQuote = { price: number; gst_rate: number; gst_amount: number; total: number };

export function useBookingQuote(priceOptionId: string | null | undefined) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-booking-quote", priceOptionId, cityId],
    enabled: !!priceOptionId,
    staleTime: 60_000,
    queryFn: async (): Promise<BookingQuote | null> => {
      const { data, error } = await rpc("app_booking_quote", { _price_option_id: priceOptionId, _city_id: cityId });
      if (error || !data) return null;
      const d = data as Record<string, unknown>;
      return { price: Number(d.price), gst_rate: Number(d.gst_rate), gst_amount: Number(d.gst_amount), total: Number(d.total) };
    },
  });
}

/** GST % for this price option from the backend quote; falls back to the general rate. */
export function useBookingGstPercent(priceOptionId: string | null | undefined): number {
  const fallback = useGstPercent();
  const { data } = useBookingQuote(priceOptionId);
  return data && Number.isFinite(data.gst_rate) ? data.gst_rate : fallback;
}

export type ContentCard = { title?: string; title_mr?: string; image_url?: string | null; included?: string[]; not_included?: string[]; included_mr?: string[]; not_included_mr?: string[]; price_option_id?: string | null };
export type ContentOption = { name?: string; name_mr?: string; price?: number; original_price?: number | null; image_url?: string | null; price_option_id: string };
export type ServiceContent = {
  hero?: { heading?: string | null; heading_mr?: string | null; subline?: string | null; subline_mr?: string | null; button?: string | null; button_mr?: string | null; image_url?: string | null; bg_color?: string | null; card_title?: string | null; card_title_mr?: string | null };
  cards?: ContentCard[];
  options?: ContentOption[];
  banner?: { slabs?: BannerSlab[] | null; texts?: Partial<Record<BannerTextKey, ContentBanner>> | null } | null;
  campaign?: ContentBanner & { active?: boolean; enabled?: boolean; link?: string | null };
  details?: ContentDetails;
};
export type BannerSlab = { from?: string | null; to?: string | null; label?: string | null; image_url?: string | null; text_color?: "light" | "dark" | null };
export type BannerTextKey = "open_free" | "open_busy" | "closed" | "holiday";
export type ContentBanner = { title?: string | null; title_mr?: string | null; subline?: string | null; subline_mr?: string | null; image_url?: string | null };
export type ContentDetails = { note?: string | null; note_mr?: string | null; note_icon?: string | null; included_title?: string | null; included_title_mr?: string | null; excluded_title?: string | null; excluded_title_mr?: string | null };

/** Language pick: Marathi field when lang=mr and non-empty, else English. */
export function pick(lang: string, en?: string | null, mr?: string | null): string {
  return (lang === "mr" && mr?.trim() ? mr : en) ?? "";
}

// --- Device cache: Clean content renders instantly from the last copy. ---
const CACHE_PREFIX = "bdy_svc_cache:";
function cacheKey(kind: string, key: string, city: string | null) { return `${CACHE_PREFIX}${kind}:${key}:${city ?? "none"}`; }
function readCache<T>(kind: string, key: string, city: string | null): T | undefined {
  if (typeof window === "undefined") return undefined;
  try { const v = window.localStorage.getItem(cacheKey(kind, key, city)); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
}
function writeCache(kind: string, key: string, city: string | null, v: unknown) {
  if (typeof window === "undefined" || v == null) return;
  try { window.localStorage.setItem(cacheKey(kind, key, city), JSON.stringify(v)); } catch { /* full */ }
}

async function fetchServiceContent(key: CleanServiceKey, cityId: string | null): Promise<ServiceContent | null> {
  const { data, error } = await rpc("app_service_content", { _service_key: key, _city_id: cityId });
  if (error) throw error;
  const v = (data ?? null) as ServiceContent | null;
  writeCache("content", key, cityId, v);
  return v;
}

export function useServiceContent(key: CleanServiceKey) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-service-content", key, cityId],
    staleTime: 5 * 60_000,
    retry: 1,
    initialData: () => readCache<ServiceContent>("content", key, cityId),
    initialDataUpdatedAt: 0, // always refresh in the background
    queryFn: () => fetchServiceContent(key, cityId),
  });
}

/** All image URLs a service's content will show on the Clean tab. */
export function contentImageUrls(c: ServiceContent | null | undefined): string[] {
  if (!c) return [];
  return [c.hero?.image_url, c.campaign?.image_url, ...(c.banner?.slabs ?? []).map((s) => s.image_url), ...(c.cards ?? []).map((x) => x.image_url), ...(c.options ?? []).map((o) => o.image_url)]
    .filter((u): u is string => !!u);
}

const loadedImages = new Set<string>();
export function isImageLoaded(url: string) { return loadedImages.has(url); }
export function preloadImages(urls: string[]): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return Promise.all(urls.map((u) => loadedImages.has(u) ? null : new Promise<void>((res) => {
    const img = new Image();
    img.onload = () => { loadedImages.add(u); res(); };
    img.onerror = () => res();
    img.src = u;
  }))).then(() => {});
}

/** Splash warm-up: content + hours + Book Now for Clean & Wash, then images. Capped at maxMs. */
export function prefetchCleanTab(qc: import("@tanstack/react-query").QueryClient, maxMs = 2000): Promise<void> {
  const cityId = getCustomerCityId();
  const keys: CleanServiceKey[] = ["clean", "wash"];
  const work = Promise.all(keys.map(async (k) => {
    const cached = readCache<ServiceContent>("content", k, cityId);
    if (cached) void preloadImages(contentImageUrls(cached));
    const [content] = await Promise.all([
      qc.fetchQuery({ queryKey: ["app-service-content", k, cityId], queryFn: () => fetchServiceContent(k, cityId), staleTime: 0 }).catch(() => cached ?? null),
      qc.prefetchQuery({ queryKey: ["app-service-hours", k, cityId], queryFn: async () => {
        const { data, error } = await rpc("app_service_hours", { _service_key: k, _city_id: cityId });
        return error ? null : ((data as { state?: ServiceState } | null)?.state ?? null);
      } }),
      k === "clean" ? qc.prefetchQuery({ queryKey: ["app-book-now-allowed", k, cityId], queryFn: async () => {
        const { data, error } = await rpc("app_book_now_allowed", { _service_key: k, _city_id: cityId });
        if (error || !data) return { allowed: true, reason: null };
        const d = data as { allowed?: boolean; reason?: BookNowGate["reason"] };
        return { allowed: d.allowed !== false, reason: d.allowed === false ? (d.reason ?? "slot_full") : null };
      } }) : null,
    ]);
    await preloadImages(contentImageUrls(content));
  })).then(() => {});
  return Promise.race([work.catch(() => {}), new Promise<void>((r) => setTimeout(r, maxMs))]);
}

/** Next free half-hour today (≥45 min notice) or tomorrow's first; null if none. */
export function useNextFreeSlot(key: CleanServiceKey, state: ServiceState | null | undefined, enabled: boolean) {
  const cityId = useCustomerCityId();
  return useQuery({
    queryKey: ["app-next-free-slot", key, cityId, state?.open_time, state?.close_time],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<{ day: "today" | "tomorrow"; label: string } | null> => {
      const { getNext7DayOptions, getAllHourSlots, isHourBookable } = await import("@/lib/hourSlots");
      const toMin = (t?: string | null) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
      const open = toMin(state?.open_time) ?? 600;
      const close = toMin(state?.close_time);
      const end = close != null ? close - 60 : 18 * 60;
      const [today, tomorrow] = getNext7DayOptions();
      const full = await fetchAppFullySlots(key, today.key, tomorrow.key);
      for (const [i, d] of [today, tomorrow].entries()) {
        const slot = getAllHourSlots(open, end).find((x) => !full.has(`${d.key}|${x.mins}`) && isHourBookable(d.key, x.mins));
        if (slot) return { day: i === 0 ? "today" : "tomorrow", label: slot.label };
      }
      return null;
    },
  });
}
