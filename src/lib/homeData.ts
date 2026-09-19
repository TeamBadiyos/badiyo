import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchSegmentServices, fetchSegments, fetchServiceCategories } from "@/lib/segments";
import { HOMEPAGE_SECTIONS_SELECT, takeEarlyJson } from "@/lib/earlyData";

export type HomepageSection = {
  section_type: string;
  display_order: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
};

export async function fetchSections(): Promise<HomepageSection[]> {
  const early = takeEarlyJson<HomepageSection[]>("homepage_sections");
  if (early) {
    try {
      return (await early) ?? [];
    } catch {
      /* fall through to the normal client call */
    }
  }
  const { data, error } = await supabase
    .from("homepage_sections")
    .select(HOMEPAGE_SECTIONS_SELECT)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HomepageSection[];
}


/**
 * Warms the three Home queries in parallel. Called as early as possible
 * (app boot / login screen / right after PIN verification) so the Home
 * screen renders from cache instead of starting its fetches on mount.
 */
export function prefetchHomeData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.prefetchQuery({ queryKey: ["segments"], queryFn: fetchSegments }),
    queryClient.prefetchQuery({
      queryKey: ["segment_services"],
      queryFn: fetchSegmentServices,
    }),
    queryClient.prefetchQuery({
      queryKey: ["service_categories"],
      queryFn: fetchServiceCategories,
    }),
    queryClient.prefetchQuery({ queryKey: ["homepage_sections"], queryFn: fetchSections }),
  ]).catch(() => {});
}
