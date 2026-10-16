import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Package, ShoppingBag, Sparkles } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAuthUser } from "@/lib/authUser";
import { ACTIVE_TRACKING_STATUSES } from "@/lib/bookingStatus";
import { COURIER_PAST_STATUSES } from "@/components/courier/courierData";
import { fetchMyStoreOrders, isStoreOrderActive } from "@/lib/storeOrders";
import { openAppRoute } from "@/lib/push";

type ActiveItem = {
  key: string;
  kind: "clean" | "parcel" | "store";
  id: string;
  title: string;
  status: string;
  createdAt: string;
};

const BOOKING_LABEL: Record<string, string> = {
  confirmed: "Finding your expert",
  accepted: "Expert confirmed",
  expert_assigned: "Expert assigned",
  on_the_way: "Expert on the way",
  arrived: "Expert has arrived",
  in_progress: "Service in progress",
};

function pretty(s: string) {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function fetchActive(): Promise<ActiveItem[]> {
  const { data: auth } = await getAuthUser();
  const uid = auth.user?.id;
  if (!uid) return [];
  const [b, c, s] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, status, created_at")
      .eq("user_id", uid)
      .is("deleted_at", null)
      .in("status", ACTIVE_TRACKING_STATUSES)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("courier_orders")
      .select("id, status, created_at, payment_status")
      .eq("customer_id", uid)
      .is("store_order_id", null)
      .order("created_at", { ascending: false })
      .limit(10),
    fetchMyStoreOrders().catch(() => []),
  ]);
  const out: ActiveItem[] = [];
  for (const r of b.data ?? [])
    out.push({
      key: `b-${r.id}`,
      kind: "clean",
      id: r.id,
      title: "Cleaning",
      status: BOOKING_LABEL[r.status] ?? pretty(r.status),
      createdAt: r.created_at ?? "",
    });
  for (const r of c.data ?? []) {
    if (COURIER_PAST_STATUSES.includes(String(r.status).toUpperCase())) continue;
    if (r.payment_status && r.payment_status !== "paid") continue;
    out.push({ key: `c-${r.id}`, kind: "parcel", id: r.id, title: "Parcel", status: pretty(r.status), createdAt: r.created_at ?? "" });
  }
  for (const o of s.filter(isStoreOrderActive))
    out.push({
      key: `s-${o.id}`,
      kind: "store",
      id: o.id,
      title: "Store order",
      status: pretty(o.status),
      createdAt: o.created_at,
    });
  return out.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

const ICONS = { clean: Sparkles, parcel: Package, store: ShoppingBag };

/** Live orders above the tab bar. Swipe sideways when there is more than one. */
export function ActiveOrdersStrip({ onOpenStoreOrder }: { onOpenStoreOrder?: (id: string) => void }) {
  const { data: items = [] } = useQuery({
    queryKey: ["active-orders-strip"],
    queryFn: fetchActive,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const [index, setIndex] = useState(0);
  if (!items.length) return null;

  const open = (it: ActiveItem) => {
    if (it.kind === "store") onOpenStoreOrder?.(it.id);
    else openAppRoute(it.kind === "clean" ? `booking/${it.id}` : `courier/${it.id}`);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--app-safe-bottom)+72px)] z-30 flex justify-center">
      <div className="pointer-events-auto w-full max-w-md px-3">
        <div
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
        >
          {items.map((it) => {
            const Icon = ICONS[it.kind];
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => open(it)}
                className="flex w-full shrink-0 snap-center items-center gap-3 rounded-[20px] bg-foreground px-4 py-3 text-left shadow-lg active:scale-[0.99]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold text-background">{it.status}</span>
                  <span className="block truncate text-xs text-background/70">{it.title} · Tap to track</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-background/70" />
              </button>
            );
          })}
        </div>
        {items.length > 1 && (
          <div className="mt-1.5 flex justify-center gap-1">
            {items.map((it, i) => (
              <span
                key={it.key}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/40"}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
