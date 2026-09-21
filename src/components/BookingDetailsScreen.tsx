import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, Calendar, Home as HomeIcon, Star, X } from "lucide-react";
import { toast } from "sonner";
import type { BookingRow } from "./MyBookingsScreen";
import { supabase } from "@/integrations/supabase/client";
import { RescheduleSheet } from "./RescheduleSheet";
import { getErrorMessage } from "@/lib/errorMessage";
import { cancelBooking } from "@/lib/bookingCancel.functions";

function refundLine(b: BookingRow): { label: string; note: string } | null {
  const status = b.refund_status ?? null;
  if (!status || status === "none") return null;
  const amount = Number(b.refund_amount ?? 0);
  if (status === "not_applicable") {
    return { label: "No refund applicable", note: "Nothing was charged for this booking." };
  }
  if (status === "refunded") {
    return { label: `Rs ${amount} refunded`, note: "Credited to your original payment method." };
  }
  if (status === "processing" || status === "pending") {
    return {
      label: `Rs ${amount} refund in progress`,
      note: "It reaches your original payment method in 5-7 working days.",
    };
  }
  return {
    label: `Rs ${amount} refund pending`,
    note: "We hit an issue with this refund. Our team is on it — contact support if it isn't resolved soon.",
  };
}


function statusPillClasses(status: string): string {
  if (status === "completed") return "bg-primary/15 text-primary";
  if (status === "cancelled") return "bg-muted text-muted-foreground";
  return "bg-blue-100 text-blue-700";
}
function statusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function slotText(b: BookingRow): { title: string; subtitle: string } {
  if (b.slot_type === "now") {
    return { title: "Now", subtitle: "Booked as ASAP service" };
  }
  const day = b.scheduled_date
    ? new Date(b.scheduled_date).toLocaleDateString("en-US", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : "Scheduled";
  return {
    title: b.scheduled_time_slot ? `${day} · ${b.scheduled_time_slot}` : day,
    subtitle: "Scheduled service",
  };
}

export function BookingDetailsScreen({
  booking,
  onBack,
}: {
  booking: BookingRow;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(booking.status);
  const [scheduledDate, setScheduledDate] = useState(booking.scheduled_date);
  const [scheduledSlot, setScheduledSlot] = useState(booking.scheduled_time_slot);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slot = slotText({
    ...booking,
    status,
    scheduled_date: scheduledDate,
    scheduled_time_slot: scheduledSlot,
  });
  const addr = booking.addresses;

  const canCancel = status === "confirmed";
  const canReschedule = status === "confirmed" && booking.slot_type === "scheduled";

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      // Goes through the server so the gateway refund actually happens.
      const result = await cancelBooking({ data: { bookingId: booking.id } });
      await qc.invalidateQueries({ queryKey: ["my-bookings"] });
      setStatus("cancelled");
      setConfirmingCancel(false);
      if (result.refund_status === "processing") {
        toast.success(
          `Booking cancelled. Refund of ₹${result.refund_amount} will reach your account in 5-7 working days.`,
        );
      } else if (result.refund_status === "pending") {
        toast.warning(
          "Booking cancelled. Your refund could not be started yet — we are retrying it and will update you shortly.",
        );
      } else {
        toast.success("Booking cancelled.");
      }
      onBack();
    } catch (e) {
      setError(await getErrorMessage(e));
    } finally {
      setCancelling(false);
    }
  }


  async function handleReschedule(date: string, slotLabel: string) {
    setSaving(true);
    setError(null);
    try {
      const { error } = await supabase
        .from("bookings")
        .update({ scheduled_date: date, scheduled_time_slot: slotLabel })
        .eq("id", booking.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["my-bookings"] });
      setScheduledDate(date);
      setScheduledSlot(slotLabel);
      setRescheduleOpen(false);
    } catch (e) {
      setError(await getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-background pb-10">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <header className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold text-foreground">Booking Details</h1>
        </header>

        {/* Status */}
        <div className="mt-5 flex items-center justify-between rounded-[18px] border border-border bg-card p-4 shadow-sm">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="mt-0.5 text-base font-bold text-foreground">
              {statusLabel(status)}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusPillClasses(
              status,
            )}`}
          >
            {statusLabel(status)}
          </span>
        </div>

        {/* Service */}
        <section className="mt-3 rounded-[18px] border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold text-foreground">
                {booking.service_label}
              </h3>
              <p className="text-xs text-muted-foreground">
                {booking.service_duration_minutes} minutes
              </p>
            </div>
          </div>
        </section>

        {/* Slot */}
        <section className="mt-3 rounded-[18px] border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">When</p>
              <h3 className="truncate text-sm font-bold text-foreground">{slot.title}</h3>
              <p className="text-xs text-muted-foreground">{slot.subtitle}</p>
            </div>
          </div>
        </section>

        {/* Address */}
        {addr && (
          <section className="mt-3 rounded-[18px] border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <HomeIcon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Address</p>
                <h3 className="text-sm font-bold text-foreground">
                  {addr.label ?? "Home"}
                </h3>
                <p className="text-xs text-muted-foreground">{addr.full_address}</p>
                {(addr.area || addr.city) && (
                  <p className="text-xs text-muted-foreground">
                    {[addr.area, addr.city].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Price breakdown */}
        <section className="mt-3 rounded-[18px] border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-bold text-foreground">Price breakdown</h3>
          <div className="mt-3 space-y-2 text-sm">
            <Row label="Service" value={`Rs ${booking.price}`} />
            <Row
              label={`GST (${Number(booking.gst_percent ?? 0)}%)`}
              value={`Rs ${Number(booking.gst_amount ?? 0)}`}
              muted
            />
            <div className="my-2 h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">Total paid</span>
              <span className="text-base font-bold text-primary">
                Rs {booking.total_amount && Number(booking.total_amount) > 0 ? Number(booking.total_amount) : booking.price}
              </span>
            </div>
          </div>
        </section>

        {/* Refund (cancelled bookings) */}
        {(() => {
          const refund = refundLine(booking);
          if (!refund) return null;
          return (
            <section className="mt-3 rounded-[18px] border border-border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-bold text-foreground">Refund</h3>
              {Number(booking.cancellation_fee ?? 0) > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Cancellation fee: Rs {Number(booking.cancellation_fee)}
                </p>
              )}
              <p className="mt-1 text-sm font-semibold text-foreground">{refund.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{refund.note}</p>
            </section>
          );
        })()}



        {/* Rating (if any) */}
        {booking.rating ? (
          <section className="mt-3 rounded-[18px] border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-bold text-foreground">Your rating</h3>
            <div className="mt-2 flex items-center gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-5 w-5 ${
                    i < (booking.rating ?? 0)
                      ? "fill-primary text-primary"
                      : "text-muted-foreground/40"
                  }`}
                />
              ))}
            </div>
            {booking.review_text && (
              <p className="mt-2 text-sm text-muted-foreground">{booking.review_text}</p>
            )}
          </section>
        ) : null}

        {error && (
          <p className="mt-3 text-center text-xs text-destructive">{error}</p>
        )}

        {(canCancel || canReschedule) && (
          <div className="mt-5 space-y-2">
            {canReschedule && (
              <button
                onClick={() => setRescheduleOpen(true)}
                className="w-full rounded-[14px] border border-primary bg-primary/10 px-4 py-3 text-sm font-bold text-primary transition active:scale-[0.99]"
              >
                Reschedule
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setConfirmingCancel(true)}
                className="w-full rounded-[14px] border border-destructive/40 bg-card px-4 py-3 text-sm font-bold text-destructive transition active:scale-[0.99]"
              >
                Cancel Booking
              </button>
            )}
          </div>
        )}

        {/* Booking id */}
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          Booking ID: {booking.id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      {/* Cancel confirmation dialog */}
      {confirmingCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-[18px] bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <h2 className="text-base font-bold text-foreground">Cancel booking?</h2>
              <button
                onClick={() => setConfirmingCancel(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-muted"
              >
                <X className="h-4 w-4 text-foreground" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to cancel this booking? This cannot be undone.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setConfirmingCancel(false)}
                className="flex-1 rounded-[14px] border border-border bg-card px-4 py-3 text-sm font-bold text-foreground"
              >
                Keep booking
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 rounded-[14px] bg-destructive px-4 py-3 text-sm font-bold text-destructive-foreground disabled:opacity-70"
              >
                {cancelling ? "Cancelling…" : "Yes, cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      <RescheduleSheet
        open={rescheduleOpen}
        initialDate={scheduledDate}
        initialSlot={scheduledSlot}
        onClose={() => setRescheduleOpen(false)}
        onConfirm={handleReschedule}
        saving={saving}
      />
    </main>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : "font-semibold text-foreground"}>
        {value}
      </span>
    </div>
  );
}
