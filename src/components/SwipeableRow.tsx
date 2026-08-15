import { useRef, useState, type ReactNode } from "react";
import { hapticImpact } from "@/lib/haptics";

export type SwipeAction = {
  label: string;
  icon?: ReactNode;
  onAction: () => void;
  /** Tailwind classes for the revealed action button. */
  className?: string;
};

/**
 * Native-style swipe row:
 *  - swipe left to reveal trailing actions (Delete / Edit style)
 *  - optional swipe-past-threshold to dismiss (notification cards)
 */
export function SwipeableRow({
  children,
  actions = [],
  onDismiss,
  dismissThreshold = 0.55,
  className = "",
}: {
  children: ReactNode;
  actions?: SwipeAction[];
  onDismiss?: () => void;
  dismissThreshold?: number;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const locked = useRef<"h" | "v" | null>(null);
  const armed = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const actionsWidth = actions.length * 84;

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    active.current = true;
    locked.current = null;
    armed.current = false;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!active.current) return;
    const t = e.touches[0];
    const deltaX = t.clientX - startX.current;
    const deltaY = t.clientY - startY.current;
    if (!locked.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      locked.current = Math.abs(deltaX) > Math.abs(deltaY) ? "h" : "v";
    }
    if (locked.current !== "h") return;

    const base = open ? -actionsWidth : 0;
    let next = base + deltaX;
    if (next > 0) next = next * 0.25; // resist right pull
    const width = containerRef.current?.offsetWidth ?? 320;
    const min = onDismiss ? -width : -(actionsWidth + 40);
    if (next < min) next = min;
    setDx(next);

    if (onDismiss) {
      const past = Math.abs(next) > width * dismissThreshold;
      if (past && !armed.current) {
        armed.current = true;
        void hapticImpact("medium");
      }
      if (!past && armed.current) armed.current = false;
    }
  }

  function onTouchEnd() {
    if (!active.current) return;
    active.current = false;
    const width = containerRef.current?.offsetWidth ?? 320;
    if (onDismiss && Math.abs(dx) > width * dismissThreshold) {
      setGone(true);
      setDx(-width);
      window.setTimeout(() => onDismiss(), 180);
      return;
    }
    if (actions.length > 0 && Math.abs(dx) > actionsWidth * 0.5) {
      setOpen(true);
      setDx(-actionsWidth);
      void hapticImpact("light");
    } else {
      setOpen(false);
      setDx(0);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${gone ? "opacity-0" : ""} transition-opacity duration-200 ${className}`}
    >
      {actions.length > 0 && (
        <div className="absolute inset-y-0 right-0 flex">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                void hapticImpact("light");
                setOpen(false);
                setDx(0);
                a.onAction();
              }}
              className={`flex w-[84px] flex-col items-center justify-center gap-1 text-xs font-bold no-select ${
                a.className ?? "bg-muted text-foreground"
              }`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          transform: `translateX(${dx}px)`,
          transition: active.current ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)",
        }}
        className="relative bg-background"
      >
        {children}
      </div>
    </div>
  );
}
