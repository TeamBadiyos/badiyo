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
  strikethrough_price: number | null;
  display_order: number | null;
  segment_id: string | null;
  service_category_id: string | null;
  image_url: string | null;
  pricing_type: string;
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
 * Bookable items = every active price option of every active service, flattened
 * and enriched with its category/segment. Services with zero active price
 * options simply contribute nothing (they are skipped, never rendered empty),
 * and that never hides sibling services or the category itself.
 */
export async function fetchSegmentServices(): Promise<SegmentService[]> {
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, image_url, pricing_type, display_order, category_id, service_categories(segment_id, icon_url), service_price_options(id, label, duration_minutes, unit_label, customer_price, strikethrough_price, display_order, is_active)",
    )
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;

  const rows: SegmentService[] = [];
  for (const svc of (data ?? []) as any[]) {
    const options = (svc.service_price_options ?? [])
      .filter((o: any) => o.is_active)
      .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));
    for (const o of options) {
      rows.push({
        id: o.id,
        icon: null,
        duration_label: o.label,
        duration_minutes: Number(o.duration_minutes ?? 60),
        subtitle: o.unit_label ?? null,
        price: Number(o.customer_price),
        strikethrough_price:
          o.strikethrough_price == null ? null : Number(o.strikethrough_price),
        display_order: o.display_order ?? svc.display_order ?? null,
        segment_id: svc.service_categories?.segment_id ?? null,
        service_category_id: svc.category_id ?? null,
        image_url: svc.image_url ?? svc.service_categories?.icon_url ?? null,
        pricing_type: svc.pricing_type,
      });
    }
  }
  return rows;
}

