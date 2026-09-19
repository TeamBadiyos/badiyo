/**
 * Cold-start accelerator.
 *
 * The four public config queries Home needs (segments, categories, bookable
 * items, homepage sections) used to start only after the whole app bundle had
 * downloaded, parsed and hydrated — about 3.5s into a cold open on mobile data.
 *
 * `buildEarlyBootScript()` is injected as a tiny inline <script> in the document
 * head, so those requests leave the phone in the first few hundred milliseconds,
 * in parallel with the JS download. The app then *consumes* the in-flight
 * promise instead of firing the request again.
 *
 * The select strings live here and are imported by the normal Supabase queries,
 * so the early request and the fallback request can never drift apart.
 */

export const SEGMENTS_SELECT = "id, name, short_name, slug, vertical_type, display_template, rank";

export const SERVICE_CATEGORIES_SELECT = "id, segment_id, name, slug, icon_url, rank";

export const SERVICES_SELECT =
  "id, name, image_url, pricing_type, display_order, category_id, description, gallery_urls, video_url, inclusions, exclusions, service_categories(segment_id, icon_url), service_price_options(id, label, duration_minutes, unit_label, customer_price, strikethrough_price, display_order, is_active, image_url, description, gallery_urls, video_url, inclusions, exclusions, item_task_types(display_order, task_types(id, name, inclusions, exclusions, is_active, rank)))";

export const HOMEPAGE_SECTIONS_SELECT = "section_type, display_order, payload";

const compact = (select: string) => select.replace(/\s+/g, "");

/** REST paths, kept in sync with the Supabase queries by sharing the selects. */
const EARLY_QUERIES = {
  segments: `segments?select=${compact(SEGMENTS_SELECT)}&is_active=eq.true&order=rank.asc`,
  service_categories: `service_categories?select=${compact(
    SERVICE_CATEGORIES_SELECT,
  )}&is_active=eq.true&order=rank.asc`,
  segment_services: `services?select=${compact(
    SERVICES_SELECT,
  )}&is_active=eq.true&order=display_order.asc`,
  homepage_sections: `homepage_sections?select=${compact(
    HOMEPAGE_SECTIONS_SELECT,
  )}&is_active=eq.true&order=display_order.asc`,
} as const;

export type EarlyKey = keyof typeof EARLY_QUERIES;

/**
 * Inline script source for the document head. Runs before the app bundle is
 * even parsed. Failures are swallowed — the app simply falls back to its normal
 * Supabase call.
 */
export function buildEarlyBootScript(url: string, key: string): string {
  return `(function(){try{var u=${JSON.stringify(url)},k=${JSON.stringify(
    key,
  )},q=${JSON.stringify(EARLY_QUERIES)},w=window;if(!u||!k)return;w.__bdEarly={};Object.keys(q).forEach(function(n){var p=fetch(u+"/rest/v1/"+q[n],{headers:{apikey:k,accept:"application/json"}}).then(function(r){if(!r.ok)throw new Error("http "+r.status);return r.json()});p.catch(function(){});w.__bdEarly[n]=p;});}catch(e){}})();`;
}

/**
 * Consumes the in-flight early request for `key`, if the head script started
 * one. One-shot: later refetches go through the normal Supabase client.
 */
export function takeEarlyJson<T>(key: EarlyKey): Promise<T> | null {
  if (typeof window === "undefined") return null;
  const store = (window as unknown as { __bdEarly?: Record<string, Promise<unknown>> }).__bdEarly;
  const pending = store?.[key];
  if (!pending) return null;
  delete store![key];
  return pending as Promise<T>;
}
