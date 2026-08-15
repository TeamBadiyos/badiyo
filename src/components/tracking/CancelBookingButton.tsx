import { useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import type { BookingRow } from "@/components/MyBookingsScreen";
import { hapticImpact } from "@/lib/haptics";

type Stage = "searching" | "assigned";

const CANCELLATION_FEE = 100;

export function CancelBookingButton({
  bookingId,
  stage,
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
  const qc = useQueryClient();

  const estimatedRefund =
    stage === "assigned" && typeof price === "number"
      ? Math.max(0, price - CANCELLATION_FEE)
      : typeof price === "number"
        ? price
        : null;

  const title =
    stage === "searching" ? "Cancel this booking?" : "Cancel with cancellation fee?";
  const description =
    stage === "searching"
      ? "You'll receive a full refund."
      : `Cancelling now will incur a ₹${CANCELLATION_FEE} cancellation fee.${
          estimatedRefund !== null ? ` You'll be refunded ₹${estimatedRefund}.` : ""
        }`;

  const handleConfirm = async () => {
    if (!bookingId || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "customer-cancel-booking",
        { body: { booking_id: bookingId } },
      );
      if (error) throw error;
      const refund =
        (data as { refund_amount?: number } | null)?.refund_amount ?? estimatedRefund;

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

      toast.success(
        refund !== null && refund !== undefined
          ? `Booking cancelled. Refund of ₹${refund} is on its way.`
          : "Booking cancelled.",
      );
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
