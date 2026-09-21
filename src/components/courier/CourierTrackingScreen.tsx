// Live parcel tracking for the customer: status steps, pickup/delivery OTP
// cards (WhatsApp resend, refresh, contact change) and cancel.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw, Send, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  resendCourierOtp,
  refreshCourierOtp,
  updateCourierContact,
} from "@/lib/courierOtp.functions";
import { fetchCourierOrder, COURIER_STEPS, courierStepIndex } from "./courierData";

type Purpose = "pickup" | "delivery";

export function CourierTrackingScreen({
  orderId,
  onBack,
}: {
  orderId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const { data: order, isLoading } = useQuery({
    queryKey: ["courier_order", orderId],
    queryFn: () => fetchCourierOrder(orderId),
    refetchInterval: 15_000,
  });

  const [codes, setCodes] = useState<Partial<Record<Purpose, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Purpose | null>(null);
  const [newPhone, setNewPhone] = useState("");

  if (isLoading || !order) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const stepIdx = courierStepIndex(order.status);
  const cancelled = order.status === "CANCELLED";
  const otpStage: Record<Purpose, boolean> = {
    pickup: order.status === "ARRIVED_PICKUP",
    delivery: order.status === "IN_TRANSIT",
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message || "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const doResend = (purpose: Purpose) =>
    run(`resend-${purpose}`, async () => {
      const res = await resendCourierOtp({ data: { order_id: orderId, purpose } });
      setCodes((c) => ({ ...c, [purpose]: res.otp }));
      toast(
        res.sent
          ? `Code sent on WhatsApp (${res.sends_used}/${res.max_sends})`
          : "WhatsApp send nahi ho paya — code niche dikha diya hai",
      );
    });

  const doRefresh = (purpose: Purpose) =>
    run(`refresh-${purpose}`, async () => {
      const res = await refreshCourierOtp({ data: { order_id: orderId, purpose } });
      setCodes((c) => ({ ...c, [purpose]: res.otp }));
      toast("New code ready");
    });

  const doUpdateContact = (purpose: Purpose) =>
    run(`contact-${purpose}`, async () => {
      await updateCourierContact({
        data: { order_id: orderId, purpose, new_phone: newPhone },
      });
      setEditing(null);
      setNewPhone("");
      setCodes((c) => ({ ...c, [purpose]: undefined }));
      await qc.invalidateQueries({ queryKey: ["courier_order", orderId] });
      toast("Contact number updated");
    });

  const cancelOrder = () =>
    run("cancel", async () => {
      const { error } = await supabase.rpc("courier_cancel_order", {
        _order_id: orderId,
        _reason: "customer_cancelled",
      });
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["courier_order", orderId] });
      toast("Order cancelled");
    });

  const canCancel = ["REQUESTED", "SEARCHING", "DRIVER_ASSIGNED", "ARRIVED_PICKUP"].includes(
    order.status,
  );

  const OtpCard = ({ purpose }: { purpose: Purpose }) => {
    const phone =
      purpose === "pickup" ? order.pickup_contact_phone : order.drop_contact_phone;
    const edits =
      (purpose === "pickup" ? order.pickup_contact_edit_count : order.drop_contact_edit_count) ?? 0;
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">
          {purpose === "pickup" ? "Pickup code" : "Delivery code"}
        </p>
        <p className="text-xs text-muted-foreground">
          {purpose === "pickup"
            ? "Rider ko ye code batayein taki parcel uthaya ja sake."
            : "Parcel milne par ye code rider ko batayein."}
        </p>
        <p className="mt-3 text-2xl font-bold tracking-[0.3em]">{codes[purpose] ?? "••••"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {phone ? `Contact: ${phone}` : "No contact number"}
          {edits ? ` · ${edits} change used` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy === `resend-${purpose}`}
            onClick={() => doResend(purpose)}
          >
            {busy === `resend-${purpose}` ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send on WhatsApp
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === `refresh-${purpose}`}
            onClick={() => doRefresh(purpose)}
          >
            <RefreshCw className="h-4 w-4" />
            New code
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(editing === purpose ? null : purpose);
              setNewPhone("");
            }}
          >
            <Pencil className="h-4 w-4" />
            Change number
          </Button>
        </div>
        {editing === purpose && (
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="New 10-digit mobile"
              inputMode="numeric"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            />
            <Button
              size="sm"
              disabled={newPhone.length !== 10 || busy === `contact-${purpose}`}
              onClick={() => doUpdateContact(purpose)}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-dvh bg-background pb-24">
      <div className="bleed-safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 pb-3 [--bleed-top-extra:12px]">
        <button type="button" onClick={onBack} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold">
          Parcel {order.order_code ? `#${order.order_code}` : ""}
        </h1>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          {cancelled ? (
            <p className="text-sm font-semibold text-destructive">This order was cancelled.</p>
          ) : (
            <ol className="space-y-2">
              {COURIER_STEPS.map((s, i) => (
                <li key={s.key} className="flex items-center gap-3 text-sm">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      i <= stepIdx ? "bg-primary" : "bg-muted"
                    }`}
                  />
                  <span className={i <= stepIdx ? "font-medium" : "text-muted-foreground"}>
                    {s.label}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-medium">Pickup</p>
          <p className="text-muted-foreground">{order.pickup_address}</p>
          <p className="mt-2 font-medium">Drop</p>
          <p className="text-muted-foreground">{order.drop_address}</p>
          <p className="mt-2 text-muted-foreground">
            {order.distance_km ? `${order.distance_km} km · ` : ""}
            ₹{Number(order.total_amount ?? 0).toFixed(2)}
          </p>
        </div>

        {otpStage.pickup && <OtpCard purpose="pickup" />}
        {otpStage.delivery && <OtpCard purpose="delivery" />}

        {canCancel && (
          <Button
            variant="outline"
            className="w-full"
            disabled={busy === "cancel"}
            onClick={cancelOrder}
          >
            Cancel order
          </Button>
        )}
        {order.status === "PICKED_UP" && (
          <p className="text-center text-xs text-muted-foreground">
            Parcel uth chuka hai, ab order cancel nahi ho sakta.
          </p>
        )}
      </div>
    </div>
  );
}
