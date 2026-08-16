import { Heart } from "lucide-react";

/**
 * A soft, oversized brand watermark for the bottom of main scrollable screens.
 * Purely decorative — no tap action.
 */
export function BrandWatermark({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center pt-12 pb-14 ${className ?? ""}`}
      aria-hidden="true"
    >
      <span className="inline-flex items-center gap-2 text-3xl font-black tracking-tight text-muted-foreground/20 select-none">
        badiyos
        <Heart className="h-6 w-6 fill-current" />
      </span>
    </div>
  );
}
