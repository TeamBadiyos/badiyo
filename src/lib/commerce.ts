/**
 * Store / Food tab data, all from Command Center functions:
 * app_commerce_home, app_store_page, app_order_again, app_list_banners.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CommerceService = "store" | "food";
export type Bi = { id?: string; name_en: string; name_mr?: string | null };

export type CommerceStore = {
  id: string;
  name: string;
  slug?: string | null;
  rating: number | null;
  rating_count?: number;
  is_open: boolean;
  photo_url: string | null;
  offer_text: string | null;
  store_type: Bi | null;
  distance_km?: number | null;
  next_open_at: string | null;
  address?: string | null;
  service_type?: string | null;
};

export type CommerceCategory = Bi & { id: string; icon_url: string | null; is_other?: boolean };

export type ItemVariant = { id: string; name: string; price: number; is_default?: boolean };
export type AddonGroup = { name: string; min: number; max: number | null; options: { id: string; name: string; price: number }[] };

export type CommerceItem = {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  size: string | null;
  price: number;
  original_price: number | null;
  in_stock: boolean;
  variants: ItemVariant[];
  addon_groups: AddonGroup[];
  store_id?: string;
  store_name?: string;
};

export type CommerceHome = {
  categories: CommerceCategory[];
  recommended: CommerceStore[];
  stores: CommerceStore[];
};

export type StorePage = {
  store: CommerceStore;
  recommended: CommerceItem[];
  menu: { category: Bi; items: CommerceItem[] }[];
};

export type Banner = { id: string; title: string | null; image_path: string | null; link_type: string | null; link_target: string | null };

export const biName = (b: Bi | null | undefined, lang: string) =>
  b ? (lang === "mr" && b.name_mr) || b.name_en : "";

export function useCommerceHome(
  service: CommerceService,
  cityId: string | null,
  coords: { lat: number; lng: number } | null,
  categoryId: string | null,
) {
  return useQuery({
    queryKey: ["commerce_home", service, cityId, coords?.lat ?? null, coords?.lng ?? null, categoryId],
    queryFn: async (): Promise<CommerceHome> => {
      const { data, error } = await supabase.rpc("app_commerce_home" as never, {
        _service_key: service,
        _city_id: cityId,
        _lat: coords?.lat ?? null,
        _lng: coords?.lng ?? null,
        _category_id: categoryId,
      } as never);
      if (error) throw error;
      const d = (data ?? {}) as Partial<CommerceHome>;
      return { categories: d.categories ?? [], recommended: d.recommended ?? [], stores: d.stores ?? [] };
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useOrderAgain(service: CommerceService, signedIn: boolean) {
  return useQuery({
    queryKey: ["order_again", service],
    enabled: signedIn,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_order_again" as never, { _service_key: service } as never);
      if (error) throw error;
      const d = (data ?? {}) as { stores?: CommerceStore[]; items?: CommerceItem[] };
      return { stores: d.stores ?? [], items: d.items ?? [] };
    },
    staleTime: 60_000,
  });
}

export function useCommerceBanner(service: CommerceService, cityId: string | null) {
  return useQuery({
    queryKey: ["commerce_banner", service, cityId],
    enabled: Boolean(cityId),
    queryFn: async (): Promise<Banner | null> => {
      const { data, error } = await supabase.rpc("app_list_banners", { _tab: service, _city_id: cityId! });
      if (error) return null;
      const list = (data ?? []) as Banner[];
      return list[0] ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

export function useStorePage(storeId: string | null) {
  return useQuery({
    queryKey: ["app_store_page", storeId],
    enabled: Boolean(storeId),
    queryFn: async (): Promise<StorePage | null> => {
      const { data, error } = await supabase.rpc("app_store_page" as never, { _store_id: storeId } as never);
      if (error) throw error;
      return (data as StorePage | null) ?? null;
    },
    staleTime: 60_000,
  });
}

/** Open stores first (nearest first), closed ones at the end (nearest first). */
export function sortStores(list: CommerceStore[]): CommerceStore[] {
  const d = (s: CommerceStore) => (s.distance_km == null ? 9999 : Number(s.distance_km));
  return [...list].sort((a, b) => Number(b.is_open) - Number(a.is_open) || d(a) - d(b));
}

export function formatOpensAt(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const ist = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const time = dt.toLocaleTimeString(lang === "mr" ? "mr-IN-u-nu-latn" : "en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  });
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (ist(dt) === ist(now)) return time;
  if (ist(dt) === ist(tomorrow)) return `${lang === "mr" ? "उद्या" : "tomorrow"} ${time}`;
  const day = dt.toLocaleDateString(lang === "mr" ? "mr-IN-u-nu-latn" : "en-IN", { timeZone: "Asia/Kolkata", weekday: "short" });
  return `${day} ${time}`;
}

export const formatKm = (km: number | null | undefined) =>
  km == null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${Number(km).toFixed(1)} km`;
