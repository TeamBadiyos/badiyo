import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, MessageCircle, RotateCw } from "lucide-react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { copyOtp } from "@/lib/bookingOtp";
import { fetchMyCourierOrders } from "@/components/courier/courierData";
import { openAppRoute } from "@/lib/push";
import { courierDropShareText, courierOtpActive, visibleCourierOtps, type CourierOtps } from "./courierOtpModel";

export async function fetchMyCourierOtps(orderId: string): Promise<CourierOtps> {
  const { data, error } = await supabase.rpc("get_my_courier_otps", { _order_id: orderId });
  if (error) throw error;
  if (!data || typeof data !== "object" || !("stops" in data) || !Array.isArray(data.stops)) throw new Error("OTP load nahi hua");
  return data as unknown as CourierOtps;
}

export function useCourierOtps(orderId: string, status?: string) {
  const qc = useQueryClient();
  const enabled = Boolean(orderId) && (!status || courierOtpActive(status));
  const q = useQuery({
    queryKey: ["customer-courier-otps", orderId],
    queryFn: () => fetchMyCourierOtps(orderId),
    enabled, staleTime: 5_000, refetchInterval: 15_000, retry: 2,
    refetchOnMount: "always", refetchOnWindowFocus: "always", refetchOnReconnect: "always",
  });
  const { refetch } = q;
  useEffect(() => { if (enabled) void refetch(); }, [status, enabled, refetch]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ["customer-courier-otps", orderId] });
      void qc.invalidateQueries({ queryKey: ["active-orders-strip"] });
      void qc.invalidateQueries({ queryKey: ["my-courier-orders"] });
    };
    const channel = supabase.channel(`customer-otp-${orderId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "courier_orders", filter: `id=eq.${orderId}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "courier_order_stops", filter: `order_id=eq.${orderId}` }, refresh).subscribe();
    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    if (Capacitor.isNativePlatform()) void App.addListener("appStateChange", ({ isActive }) => { if (isActive) refresh(); }).then((listener) => {
      if (disposed) void listener.remove(); else removeListener = () => listener.remove();
    });
    return () => { disposed = true; void supabase.removeChannel(channel); void removeListener?.(); };
  }, [orderId, enabled, qc]);
  return q;
}

export function CourierOtpCard({ orderId, status, compact = false }: { orderId: string; status?: string; compact?: boolean }) {
  const q = useCourierOtps(orderId, status);
  if (status && !courierOtpActive(status)) return null;
  const stops = visibleCourierOtps(q.data, status);
  const failed = q.isError || (!q.isPending && !q.isFetching && (!q.data || (stops.length === 0 && courierOtpActive(q.data.status) && q.data.stops.length > 0))) || stops.some((s) => !(s.pickup_otp ?? s.drop_otp));
  return (
    <div className="space-y-2 text-foreground" onClick={(e) => e.stopPropagation()}>
      {q.isPending && <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> OTP load ho raha hai…</p>}
      {failed && <div className="flex flex-wrap items-center justify-center gap-2"><p className="text-sm font-semibold">OTP load nahi hua</p><Button size="sm" variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}><RotateCw className="h-4 w-4" /> Retry</Button></div>}
      {stops.map((s, i) => {
        const code = s.pickup_otp ?? s.drop_otp;
        if (!code) return null;
        const pickup = s.stop_type === "pickup";
        return <div key={s.stop_id} className="border-t border-border py-2 text-center">
          <p className="text-xs font-bold text-muted-foreground">{pickup ? "Pickup OTP" : s.stop_type === "return" ? "Return OTP" : "Drop OTP"}{stops.length > 1 ? ` ${i + 1}` : ""} {s.contact_name ? `· ${s.contact_name}` : ""}</p>
          <div className="flex items-center justify-center gap-3">
            <span className={`font-mono font-extrabold text-primary ${compact ? "text-2xl" : "text-4xl"}`}>{code}</span>
            <Button size="icon" variant="outline" aria-label={`Copy ${pickup ? "pickup" : "drop"} OTP${s.contact_name ? ` for ${s.contact_name}` : ""}`} onClick={() => void copyOtp(code)}><Copy className="h-4 w-4" /></Button>
          </div>
          {!pickup && <Button asChild size="sm" variant="outline" className="mt-1"><a href={`https://wa.me/?text=${encodeURIComponent(courierDropShareText(code))}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" /> Share drop OTP</a></Button>}
        </div>;
      })}
    </div>
  );
}

export function ActiveCourierCards() {
  const { data: orders = [] } = useQuery({ queryKey: ["my-courier-orders"], queryFn: fetchMyCourierOrders, refetchInterval: 15_000 });
  return <div className="space-y-3">{orders.filter((o) => courierOtpActive(o.status)).map((o) => <div key={o.id} className="border-b border-border py-4">
    <div className="flex items-center justify-between gap-2"><p className="text-sm font-bold">Parcel {o.order_code}</p><Button size="sm" variant="outline" onClick={() => openAppRoute(`courier/${o.id}`)}>Track parcel</Button></div>
    <CourierOtpCard orderId={o.id} status={o.status} compact />
  </div>)}</div>;
}