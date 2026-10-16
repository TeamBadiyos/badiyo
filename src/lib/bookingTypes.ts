// Shared booking selection types (service + slot) used by Clean booking, checkout and payment.

export type TaskTypeDetail = {
  id: string;
  name: string;
  inclusions: string[];
  exclusions: string[];
};

export type SelectedService = {
  /** service_price_options.id — used for server-side price lookup. */
  id?: string | null;
  service_category_id?: string | null;
  duration_label: string;
  duration_minutes: number;
  price: number;
  subtitle: string | null;
  icon: string | null;
  segment_id?: string | null;
  segment_name?: string | null;
  task_slug?: string | null;
  /** Rich product-detail fields (all optional — older callers fall back). */
  service_name?: string | null;
  strikethrough_price?: number | null;
  pricing_type?: string | null;
  image_url?: string | null;
  gallery_urls?: string[] | null;
  video_url?: string | null;
  description?: string | null;
  inclusions?: string[] | null;
  exclusions?: string[] | null;
  /** Per-task-type breakdown; takes precedence over the flat lists. */
  task_types?: TaskTypeDetail[] | null;
};


export type SelectedSlot = ({ mode: "now" }
  | {
      mode: "later";
      day: string;
      slotId: number; // start time, minutes since midnight (e.g. 630 = 10:30 AM)
      slotLabel: string;
      slotRange: string;
    }) & { serviceKey?: "clean" | "wash" };
