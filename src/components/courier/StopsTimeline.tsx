// Multi-stop parcel pieces for the tracking screen: stops timeline with
// per-stop OTP + share + contact edit, the return-charge card and final info.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Phone, Share2, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { courierUpdateStopContact, createReturnChargePayment } from "@/lib/courier.functions";
import { payWithRazorpay, toPaymentError } from "@/lib/razorpayCheckout";
import { getPaymentPrefill } from "@/lib/paymentPrefill";
import { courierErrorMessage } from "@/lib/courierError";
import type { CourierCharge, CourierParcel, CourierStop } from "./courierData";

const TERMINAL = ["completed", "failed", "cancelled"];

export function shortAddress(a?: string | null) {
  return (a ?? "").split(",").slice(0, 2).join(",").trim() || "the location";
}

function typeLabel(t: CourierStop["stop_type"]) {
  return t === "pickup" ? "Pickup" : t === "drop" ? "Drop" : "Return";
}

function statusLabel(s: string) {
  switch (s) {
    case "pending": return "Upcoming";
    case "arrived": return "Rider here";
    case "completed": return "Done";
    case "failed": return "Not completed";
    case "cancelled": return "Cancelled";
    default: return s;
  }
}

/** Native share sheet, falling back to a WhatsApp link. */
export async function shareOtp(text: string) {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

export function otpShareText(type: CourierStop["stop_type"], address: string | null, otp: string) {
  const kind = type === "pickup" ? "Pickup" : type === "drop" ? "Drop" : "Return";
  return `badiyos parcel OTP for ${kind} at ${shortAddress(address)}: ${otp}. Share it only with the badiyos rider at the location.`;
}

export function currentStopId(stops: CourierStop[], riderAssigned: boolean, active: boolean) {
  if (!riderAssigned || !active) return null;
  return stops.find((s) => !TERMINAL.includes(s.status))?.id ?? null;
}

export function StopsTimeline({
  orderId,
  stops,
  otps,
  currentId,
  editable,
}: {
  orderId: string;
  stops: CourierStop[];
  otps: Record<string, string | null>;
  currentId: string | null;
  editable: boolean;
}) {
  const [editing, setEditing] = useState<CourierStop | null>(null);
  const anyOtp = Object.values(otps).some(Boolean);
  const counters: Record<string, number> = {};
  return (
    <div className="rounded-[20px] border border-border bg-card p-4">
      <p className="mb-3 text-sm font-bold">Stops</p>
      <ol className="space-y-3">
        {stops.map((st) => {
          counters[st.stop_type] = (counters[st.stop_type] ?? 0) + 1;
          const n = counters[st.stop_type];
          const otp = otps[st.id] ?? null;
          const isCurrent = st.id === currentId;
          const badge =
            st.stop_type === "pickup"
              ? "bg-primary text-primary-foreground"
              : st.stop_type === "drop"
                ? "bg-destructive text-destructive-foreground"
                : "bg-warning text-warning-foreground";
          return (
            <li
              key={st.id}
              className={`rounded-2xl border p-3 ${isCurrent ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge}`}>
                  {typeLabel(st.stop_type)} {n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold">{st.address}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {st.contact_name} {st.contact_phone ? `· ${st.contact_phone}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    st.status === "completed"
                      ? "bg-primary/10 text-primary"
                      : st.status === "failed" || st.status === "cancelled"
                        ? "bg-destructive/10 text-destructive"
                        : isCurrent
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCurrent && st.status === "pending" ? "Rider heading here" : statusLabel(st.status)}
                </span>
              </div>
              {otp && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-primary/5 p-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="text-xl font-extrabold tracking-[0.3em] text-primary">{otp}</span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void shareOtp(otpShareText(st.stop_type, st.address, otp))}
                  >
                    <Share2 className="h-4 w-4" /> Share
                  </Button>
                </div>
              )}
              {editable && !TERMINAL.includes(st.status) && (
                <button
                  type="button"
                  onClick={() => setEditing(st)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                >
                  <Pencil className="h-3 w-3" /> Edit contact
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {!anyOtp && (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          OTP appears here when the rider reaches the pickup / leaves for the drops.
        </p>
      )}
      {editing && (
        <EditContactDialog orderId={orderId} stop={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function EditContactDialog({ orderId, stop, onClose }: { orderId: string; stop: CourierStop; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(stop.contact_name ?? "");
  const [phone, setPhone] = useState((stop.contact_phone ?? "").replace(/\D/g, "").slice(-10));
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length > 0 && /^[6-9]\d{9}$/.test(phone);
  const save = async () => {
    setSaving(true);
    try {
      await courierUpdateStopContact({ data: { stop_id: stop.id, name: name.trim(), phone } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["courier-stops", orderId] }),
        qc.invalidateQueries({ queryKey: ["courier-order-otps", orderId] }),
      ]);
      toast("Contact updated");
      onClose();
    } catch (e) {
      toast.error(courierErrorMessage(e, "Could not update the contact. Please try again."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%_-_32px)] max-w-sm rounded-lg p-5">
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <UserRound className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" className="h-12 pl-10" />
          </div>
          <div className="relative">
            <Phone className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="Mobile number"
              className="h-12 pl-10"
            />
          </div>
          <Button className="h-11 w-full font-bold" disabled={!valid || saving} onClick={save}>
            {saving ? <Loader2 className="animate-spin" /> : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnChargeCard({
  orderId,
  charge,
  dropLabel,
}: {
  orderId: string;
  charge: CourierCharge;
  dropLabel: string;
}) {
  const qc = useQueryClient();
  const [paying, setPaying] = useState(false);
  const amount = Number(charge.total_amount ?? 0);
  if (charge.status === "paid") {
    return (
      <div className="flex items-center gap-3 rounded-[20px] border border-primary/30 bg-primary/5 p-4">
        <CheckCircle2 className="h-5 w-5 text-primary" />
        <p className="text-sm font-semibold text-primary">Return charge paid</p>
      </div>
    );
  }
  const pay = async () => {
    setPaying(true);
    try {
      const rz = await createReturnChargePayment({ data: { charge_id: charge.id } });
      const prefill = await getPaymentPrefill();
      await payWithRazorpay({
        key: rz.key_id,
        amount: rz.amount,
        currency: "INR",
        order_id: rz.razorpay_order_id,
        name: "Badiyos",
        description: "Parcel return charge",
        contact: prefill.contact,
        email: prefill.email,
        customerName: prefill.name,
      });
      toast("Payment received. Confirming…");
      await qc.invalidateQueries({ queryKey: ["courier-charges", orderId] });
    } catch (e) {
      const pe = toPaymentError(e);
      if (pe.category === "cancelled") toast("Payment cancelled");
      else toast.error(courierErrorMessage(e, "Payment could not be completed. Please try again."));
    } finally {
      setPaying(false);
    }
  };
  return (
    <div className="rounded-[20px] border-2 border-warning/50 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <p className="text-sm font-semibold text-foreground">
          Delivery could not be completed at {dropLabel}. Pay ₹{amount.toFixed(2)} return charge to get your parcel back.
        </p>
      </div>
      <Button className="mt-3 h-11 w-full font-bold" disabled={paying} onClick={pay}>
        {paying ? <Loader2 className="animate-spin" /> : `Pay ₹${amount.toFixed(2)}`}
      </Button>
    </div>
  );
}

export function parcelSummary(parcels: CourierParcel[]) {
  const delivered = parcels.filter((p) => p.status === "delivered").length;
  const returned = parcels.filter((p) => p.status === "returned").length;
  if (parcels.length <= 1 || (delivered === parcels.length)) return null;
  const parts = [`${delivered} of ${parcels.length} parcels delivered`];
  if (returned) parts.push(`${returned} returned`);
  return parts.join(", ");
}
