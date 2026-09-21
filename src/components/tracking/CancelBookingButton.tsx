import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getErrorMessage } from "@/lib/errorMessage";
import type { BookingRow } from "@/components/MyBookingsScreen";
import { hapticImpact } from "@/lib/haptics";
import { cancelBooking, getCancellationQuote } from "@/lib/bookingCancel.functions";

type Stage = "searching" | "assigned";

export function CancelBookingButton({
  bookingId,
  price,
  onCancelled,
}: {
  bookingId: string | null;
  stage: Stage;
  price?: number | null;
  onCancelled?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quote, setQuote] = useState<
    { paid: number; cancellation_fee: number; refund_amount: number } | null
  >(null);
  const qc = useQueryClient();

  // The fee is configured server-side, so ask before promising anything.
  useEffect(() => {
    if (!open || !bookingId) return;
    let alive = true;
    getCancellationQuote({ data: { bookingId } })
      .then((q) => alive && setQuote(q))
      .catch(() => alive && setQuote(null));
    return () => {
      alive = false;
    };
  }, [open, bookingId]);

  const fee = quote?.cancellation_fee ?? null;
  const refundable = quote?.refund_amount ?? null;
  const paid = quote?.paid ?? (typeof price === "number" ? price : null);

  const title =
    fee && fee > 0 ? "Cancel with cancellation fee?" : "Cancel this booking?";
  const description = !quote
    ? "Checking your refund…"
    : (paid ?? 0) <= 0
      ? "Nothing was charged for this booking, so there is no refund."
      : fee && fee > 0
        ? `A ₹${fee} cancellation fee applies. ₹${refundable} will be refunded to your original payment method in 5-7 working days.`
        : `₹${refundable} will be refunded to your original payment method in 5-7 working days.`;


  const handleConfirm = async () => {
    if (!bookingId || submitting) return;
    setSubmitting(true);
    try {
      const result = await cancelBooking({ data: { bookingId } });

      // Optimistically reflect cancellation across list/tracking caches so
      // Home/Orders don't render a stale "active" card before realtime lands.
      qc.setQueryData<BookingRow[] | undefined>(["my-bookings"], (prev) =>
        prev
          ? prev.map((b) =>
              b.id === bookingId ? { ...b, status: "cancelled" } : b,
            )
          : prev,
      );
      qc.setQueryData(["searching-booking", bookingId], (prev: unknown) =>
        prev
          ? { ...(prev as object), status: "cancelled", deleted_at: new Date().toISOString() }
          : prev,
      );
      qc.setQueryData(["expert-assigned-booking", bookingId], (prev: unknown) =>
        prev
          ? { ...(prev as object), status: "cancelled", deleted_at: new Date().toISOString() }
          : prev,
      );
      await qc.invalidateQueries({ queryKey: ["my-bookings"] });

      // Tell the customer exactly what happened to their money.
      if (result.refund_status === "processing") {
        toast.success(
          `Booking cancelled. Refund of ₹${result.refund_amount} will reach your account in 5-7 working days.`,
        );
      } else if (result.refund_status === "pending") {
        toast.warning(
          "Booking cancelled. Your refund could not be started yet — we are retrying it and will update you shortly.",
        );
      } else if (result.refund_status === "none") {
        toast.success(
          `Booking cancelled. The ₹${result.cancellation_fee} cancellation fee used up the amount paid, so there is no refund.`,
        );
      } else {
        toast.success("Booking cancelled. No payment was charged, so there is no refund.");
      }
      setOpen(false);
      onCancelled?.();
    } catch (err) {
      toast.error(await getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <>
      <button
        type="button"
        onClick={() => { void hapticImpact("light"); setOpen(true); }}
        className="mt-4 w-full rounded-[14px] border border-border bg-background px-4 py-3 text-sm font-bold text-muted-foreground active:scale-[0.99] hover:text-destructive hover:border-destructive/40"
      >
        Cancel booking
      </button>

      <AlertDialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              disabled={submitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling…
                </>
              ) : (
                "Yes, cancel"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
