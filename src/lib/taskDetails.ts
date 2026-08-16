import { supabase } from "@/integrations/supabase/client";

export type ServiceTaskDetail = {
  id: string;
  segment_id: string;
  task_name: string;
  task_slug: string;
  icon_url: string | null;
  included_items: string[];
  excluded_items: string[];
  rank: number;
};

/**
 * Active "what's included / not included" task rows, optionally scoped to a
 * segment (e.g. the Clean segment). Returns [] when nothing is seeded yet so
 * the sheet can render its empty state.
 */
export async function fetchServiceTaskDetails(
  segmentId?: string | null,
): Promise<ServiceTaskDetail[]> {
  let q = supabase
    .from("service_task_details")
    .select(
      "id, segment_id, task_name, task_slug, icon_url, included_items, excluded_items, rank",
    )
    .eq("is_active", true)
    .order("rank", { ascending: true });
  if (segmentId) q = q.eq("segment_id", segmentId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    segment_id: r.segment_id,
    task_name: r.task_name,
    task_slug: r.task_slug,
    icon_url: r.icon_url,
    included_items: (r.included_items ?? []) as string[],
    excluded_items: (r.excluded_items ?? []) as string[],
    rank: r.rank ?? 0,
  }));
}
