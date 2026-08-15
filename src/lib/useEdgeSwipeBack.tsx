import { useEffect, useRef, useState } from "react";
import { hapticImpact } from "@/lib/haptics";

const EDGE_ZONE = 28; // px from the left edge that starts the gesture
const COMMIT_RATIO = 0.28; // fraction of screen width needed to commit

/**
 * iOS-style edge-swipe-from-left to go back. Returns a live drag offset so the
 * screen can follow the finger, plus a dimming overlay progress value.
 */
export function useEdgeSwipeBack(onBack: (() => void) | null, enabled = true) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const armed = useRef(false);
  const dxRef = useRef(0);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      tracking.current = false;
      armed.current = false;
      dxRef.current = 0;
      setDx(0);
      setDragging(false);
    };

    const onStart = (e: TouchEvent) => {
      if (!onBackRef.current) return;
      const t = e.touches[0];
      if (t.clientX > EDGE_ZONE) return;
      tracking.current = true;
      armed.current = false;
      startX.current = t.clientX;
      startY.current = t.clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking.current) return;
      const t = e.touches[0];
      const deltaX = t.clientX - startX.current;
      const deltaY = t.clientY - startY.current;
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 12) {
        // Vertical scroll wins.
        reset();
        return;
      }
      if (deltaX <= 0) return;
      setDragging(true);
      dxRef.current = deltaX;
      setDx(deltaX);
      const commit = window.innerWidth * COMMIT_RATIO;
      if (!armed.current && deltaX > commit) {
        armed.current = true;
        void hapticImpact("light");
      }
      if (armed.current && deltaX <= commit) armed.current = false;
    };

    const onEnd = () => {
      if (!tracking.current) return;
      const commit = window.innerWidth * COMMIT_RATIO;
      const shouldGoBack = dxRef.current > commit;
      reset();
      if (shouldGoBack) onBackRef.current?.();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  const width = typeof window !== "undefined" ? window.innerWidth : 400;
  const progress = Math.min(1, dx / width);

  return {
    dragging,
    /** Style to spread on the screen wrapper so it follows the finger. */
    style: dragging
      ? ({
          transform: `translateX(${dx}px)`,
          transition: "none",
          willChange: "transform",
          boxShadow: "-12px 0 28px rgba(0,0,0,0.18)",
        } as const)
      : ({} as const), // no transform at rest: keeps position:fixed children anchored to the viewport
    progress,
  };
}
