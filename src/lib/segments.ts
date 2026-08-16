import { supabase } from "@/integrations/supabase/client";

export type DisplayTemplate = "CATEGORY_FIRST" | "STORE_FIRST" | "SEARCH_FIRST" | (string & {});

export type Segment = {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  vertical_type: string;
  display_template: DisplayTemplate;
  rank: number;
};

export type ServiceCategory = {
  id: string;
  segment_id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  rank: number;
};

export type SegmentService = {
  id: string;
  icon: string | null;
  duration_label: string;
  duration_minutes: number;
  subtitle: string | null;
  price: number;
  display_order: number | null;
  segment_id: string | null;
  service_category_id: string | null;
  image_url: string | null;
};

export async function fetchSegments(): Promise<Segment[]> {
  const { data, error } = await supabase
    .from("segments")
    .select("id, name, short_name, slug, vertical_type, display_template, rank")
    .eq("is_active", true)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Segment[];
}

export async function fetchServiceCategories(): Promise<ServiceCategory[]> {
  const { data, error } = await supabase
    .from("service_categories")
    .select("id, segment_id, name, slug, icon_url, rank")
    .eq("is_active", true)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ServiceCategory[];
}

/**
 * Service catalogue rows enriched with the segment they belong to
 * (via service_categories.segment_id). Segment pages / sections filter on
 * `segment_id`; the legacy single-segment flow just uses the whole list.
 */
export async function fetchSegmentServices(): Promise<SegmentService[]> {
  const { data, error } = await supabase
    .from("service_catalogue_config")
    .select(
      "id, icon, duration_label, duration_minutes, subtitle, price, display_order, service_category_id, service_categories(segment_id, icon_url)",
    )
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    icon: r.icon,
    duration_label: r.duration_label,
    duration_minutes: r.duration_minutes,
    subtitle: r.subtitle,
    price: r.price,
    display_order: r.display_order,
    segment_id: r.service_categories?.segment_id ?? null,
    service_category_id: r.service_category_id ?? null,
    image_url: r.service_categories?.icon_url ?? null,
  }));
}
