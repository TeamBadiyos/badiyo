import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BookingRow } from "@/components/MyBookingsScreen";
import { CancelRefundDialog } from "@/components/CancelRefundDialog";
import { useLanguage } from "@/i18n";
import { hapticImpact } from "@/lib/haptics";

type Stage = "searching" | "assigned";

export function CancelBookingButton({
  bookingId,
  onCancelled,
}: {
  bookingId: string | null;
  stage: Stage;
  price?: number | null;
  onCancelled?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { lang } = useLanguage();

  return (
    <>
      <button
        type="button"
        onClick={() => { void hapticImpact("light"); setOpen(true); }}
        className="mt-4 w-full rounded-[14px] border border-border bg-background px-4 py-3 text-sm font-bold text-muted-foreground active:scale-[0.99] hover:text-destructive hover:border-destructive/40"
      >
        {lang === "mr" ? "बुकिंग रद्द करा" : "Cancel booking"}
      </button>
      <CancelRefundDialog
        bookingId={bookingId}
        open={open}
        onClose={() => setOpen(false)}
        onCancelled={async () => {
          qc.setQueryData<BookingRow[] | undefined>(["my-bookings"], (prev) =>
            prev?.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" } : b)),
          );
          for (const k of ["searching-booking", "expert-assigned-booking"]) {
            qc.setQueryData([k, bookingId], (prev: unknown) =>
              prev ? { ...(prev as object), status: "cancelled", deleted_at: new Date().toISOString() } : prev,
            );
          }
          await qc.invalidateQueries({ queryKey: ["my-bookings"] });
          void qc.invalidateQueries({ queryKey: ["wallet_transactions"] });
          setOpen(false);
          onCancelled?.();
        }}
      />
    </>
  );
}
