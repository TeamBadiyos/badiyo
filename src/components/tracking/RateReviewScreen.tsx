import { useState } from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/i18n";
import { hapticImpact, hapticSelection } from "@/lib/haptics";

export function RateReviewScreen({
  bookingId,
  onSubmit,
}: {
  bookingId: string | null;
  onSubmit: () => void;
}) {
  const t = useT();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    if (bookingId) {
      const { error } = await supabase.rpc("submit_booking_review", {
        _booking_id: bookingId,
        _rating: rating || 0,
        _review: text.trim() || "",
      });
      if (error) console.error("review submit failed:", error);
    }
    setSubmitting(false);
    onSubmit();
  }

  return (
    <main className="min-h-screen w-full bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pt-10 pb-8">
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground">{t("review.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("review.sub")}
          </p>
        </div>

        <div className="mt-8 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => { void hapticSelection(); setRating(n); }}
              aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
              className="p-1 transition active:scale-90"
            >
              <Star
                className={`h-10 w-10 ${
                  n <= rating
                    ? "fill-primary text-primary"
                    : "text-muted-foreground/40"
                }`}
              />
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("review.placeholder")}
          rows={4}
          className="mt-8 w-full resize-none rounded-[14px] border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
        />

        <div className="mt-auto pt-10">
          <button
            type="button"
            onClick={() => { void hapticImpact("medium"); handleSubmit(); }}
            disabled={submitting}
            className="w-full rounded-[14px] bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground transition active:scale-[0.99] disabled:opacity-60"
          >
            {submitting ? t("review.submitting") : t("review.submit")}
          </button>
        </div>
      </div>
    </main>
  );
}
