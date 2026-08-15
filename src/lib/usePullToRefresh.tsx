import { useEffect, useRef, useState } from "react";
import { hapticImpact } from "@/lib/haptics";

/**
 * Native-feeling pull-to-refresh. Triggers `onRefresh` when the user drags
 * down from the top of the page past `threshold` pixels. Includes rubber-band
 * damping and a light haptic tap the moment the threshold is crossed.
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void, threshold = 70) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const armed = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  refreshingRef.current = refreshing;

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if ((window.scrollY || document.documentElement.scrollTop) > 0) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
      armed.current = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!active.current || startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Rubber-band damping.
      const damped = Math.min(120, dy * 0.5);
      pullRef.current = damped;
      setPull(damped);
      if (!armed.current && damped >= threshold) {
        armed.current = true;
        void hapticImpact("light");
      }
      if (armed.current && damped < threshold) armed.current = false;
    };
    const onTouchEnd = async () => {
      if (!active.current) return;
      active.current = false;
      startY.current = null;
      if (pullRef.current >= threshold && !refreshingRef.current) {
        setRefreshing(true);
        refreshingRef.current = true;
        setPull(60);
        try {
          await onRefreshRef.current();
        } finally {
          setRefreshing(false);
          refreshingRef.current = false;
          pullRef.current = 0;
          setPull(0);
        }
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [threshold]);

  return { pull, refreshing };
}

export function PullToRefreshIndicator({
  pull,
  refreshing,
}: {
  pull: number;
  refreshing: boolean;
}) {
  if (pull <= 0 && !refreshing) return null;
  const progress = Math.min(1, pull / 70);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      style={{
        top: "env(safe-area-inset-top, 0px)",
        transform: `translateY(${Math.min(pull, 80) - 20}px)`,
        opacity: refreshing ? 1 : Math.max(0.35, progress),
      }}
    >
      <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md">
        <div
          className={`h-4 w-4 rounded-full border-2 border-primary border-t-transparent ${
            refreshing ? "animate-spin" : ""
          }`}
          style={{
            transform: refreshing ? undefined : `rotate(${pull * 3}deg) scale(${0.6 + progress * 0.4})`,
          }}
        />
      </div>
    </div>
  );
}
