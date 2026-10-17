// Parcel booking draft: survives moving between Parcel home, Choose vehicle,
// multi-stop and Checkout (and back), so choices are never lost.
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";

export type ParcelAddr = {
  id: string;
  label: string | null;
  full_address: string;
  area: string | null;
  city: string | null;
  is_default?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type ParcelStop = {
  key: string; // P1, P2… / D1, D2…
  type: "pickup" | "drop";
  addr: ParcelAddr | null;
  name: string;
  phone: string;
  flat?: string;
};

export type ParcelDraft = {
  mode: "single" | "multiDrop" | "multiPickup";
  stops: ParcelStop[];
  vehicleId: string | null;
  typeId: string | null;
  note: string;
  coupon: string | null;
  useWallet: boolean;
};

const KEY = "bdy_parcel_draft";
const RECENT = "bdy_parcel_recent_drops";

let mem: ParcelDraft | null = null;

export function emptyDraft(pickup: ParcelAddr | null): ParcelDraft {
  return {
    mode: "single",
    stops: [
      { key: "P1", type: "pickup", addr: pickup, name: "", phone: "" },
      { key: "D1", type: "drop", addr: null, name: "", phone: "" },
    ],
    vehicleId: null,
    typeId: null,
    note: "",
    coupon: null,
    useWallet: false,
  };
}

export function readDraft(): ParcelDraft | null {
  if (mem) return mem;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    mem = raw ? (JSON.parse(raw) as ParcelDraft) : null;
  } catch {
    mem = null;
  }
  return mem;
}

export function writeDraft(d: ParcelDraft) {
  mem = d;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function clearDraft() {
  mem = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function hasCoords(a: ParcelAddr | null | undefined): a is ParcelAddr & { latitude: number; longitude: number } {
  return a?.latitude != null && a?.longitude != null;
}

export function readRecentDrops(): ParcelAddr[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(window.localStorage.getItem(RECENT) ?? "[]") as ParcelAddr[];
    return Array.isArray(list) ? list.slice(0, 3) : [];
  } catch {
    return [];
  }
}

export function pushRecentDrop(a: ParcelAddr) {
  if (typeof window === "undefined" || !hasCoords(a)) return;
  const same = (x: ParcelAddr) => x.id === a.id || x.full_address === a.full_address;
  const next = [a, ...readRecentDrops().filter((x) => !same(x))].slice(0, 3);
  try {
    window.localStorage.setItem(RECENT, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export async function fetchParcelAddresses(): Promise<ParcelAddr[]> {
  const { data: u } = await getAuthUser();
  const uid = u.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from("addresses")
    .select("id, label, full_address, area, city, is_default, latitude, longitude")
    .eq("user_id", uid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ParcelAddr[];
}

export function addrTitle(a: ParcelAddr | null | undefined): string {
  if (!a) return "";
  return [a.label, a.area].filter(Boolean).join(" · ") || a.full_address;
}

export const phone10 = (v: string) => v.replace(/\D/g, "").slice(-10);
