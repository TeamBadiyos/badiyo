import { supabase } from "@/integrations/supabase/client";
import { serviceImageUrl, serviceImageUrls } from "@/lib/serviceImage";
import {
  SEGMENTS_SELECT,
  SERVICES_SELECT,
  SERVICE_CATEGORIES_SELECT,
  takeEarlyJson,
} from "@/lib/earlyData";


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

export type TaskTypeDetail = {
  id: string;
  name: string;
  inclusions: string[];
  exclusions: string[];
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
  /** Parent service name (the product's title). */
  service_name: string;
  description: string | null;
  gallery_urls: string[];
  video_url: string | null;
  inclusions: string[];
  exclusions: string[];
  /** Task types linked to this bookable item, ordered for display. */
  task_types: TaskTypeDetail[];
};



export async function fetchSegments(): Promise<Segment[]> {
  // Reuse the request the head script already started, when there is one.
  const early = takeEarlyJson<Segment[]>("segments");
  if (early) {
    try {
      return (await early) ?? [];
    } catch {
      /* fall through to the normal client call */
    }
  }
  const { data, error } = await supabase
    .from("segments")
    .select(SEGMENTS_SELECT)
    .eq("is_active", true)
    .order("rank", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Segment[];
}

function mapCategories(rows: ServiceCategory[]): ServiceCategory[] {
  return rows.map((c) => ({ ...c, icon_url: serviceImageUrl(c.icon_url) }));
}

export async function fetchServiceCategories(): Promise<ServiceCategory[]> {
  const early = takeEarlyJson<ServiceCategory[]>("service_categories");
  if (early) {
    try {
      return mapCategories((await early) ?? []);
    } catch {
      /* fall through */
    }
  }
  const { data, error } = await supabase
    .from("service_categories")
    .select(SERVICE_CATEGORIES_SELECT)
    .eq("is_active", true)
    .order("rank", { ascending: true });
  if (error) throw error;
  return mapCategories((data ?? []) as ServiceCategory[]);
}


/**
 * Bookable items = every active price option of every active service, flattened
 * and enriched with its category/segment. Services with zero active price
 * options simply contribute nothing (they are skipped, never rendered empty),
 * and that never hides sibling services or the category itself.
 */
/** Normalises a possibly-null text[] column into a clean string list. */
function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchServicesRaw(): Promise<any[]> {
  const early = takeEarlyJson<any[]>("segment_services");
  if (early) {
    try {
      return (await early) ?? [];
    } catch {
      /* fall through */
    }
  }
  const { data, error } = await supabase
    .from("services")
    .select(SERVICES_SELECT)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function fetchSegmentServices(): Promise<SegmentService[]> {
  const data = await fetchServicesRaw();

  const rows: SegmentService[] = [];
  for (const svc of data as any[]) {

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
        image_url: serviceImageUrl(
          o.image_url ?? svc.image_url ?? svc.service_categories?.icon_url,
        ),
        pricing_type: svc.pricing_type,
        service_name: svc.name,
        description: o.description ?? svc.description ?? null,
        // Media is per-item: only fall back to the parent service's gallery/video
        // when the item has no media of its own at all.
        gallery_urls: serviceImageUrls(
          o.image_url || list(o.gallery_urls).length || o.video_url
            ? list(o.gallery_urls)
            : list(svc.gallery_urls),
        ),
        video_url:
          o.image_url || list(o.gallery_urls).length || o.video_url
            ? (o.video_url ?? null)
            : (svc.video_url ?? null),
        inclusions: list(o.inclusions).length ? list(o.inclusions) : list(svc.inclusions),
        exclusions: list(o.exclusions).length ? list(o.exclusions) : list(svc.exclusions),
        task_types: ((o.item_task_types ?? []) as any[])
          .map((l: any) => ({ link: l, tt: l.task_types }))
          .filter((x) => x.tt && x.tt.is_active !== false)
          .sort(
            (a, b) =>
              (a.link.display_order ?? 0) - (b.link.display_order ?? 0) ||
              (a.tt.rank ?? 0) - (b.tt.rank ?? 0),
          )
          .map(({ tt }) => ({
            id: String(tt.id),
            name: String(tt.name),
            inclusions: list(tt.inclusions),
            exclusions: list(tt.exclusions),
          }))
          .filter((tt) => tt.inclusions.length > 0 || tt.exclusions.length > 0),
      });

    }
  }
  return rows;
}

