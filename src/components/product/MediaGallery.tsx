import { useRef, useState } from "react";

export type MediaItem =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string };

/**
 * Swipeable hero carousel (scroll-snap) with dot indicators.
 * Renders nothing when there is no media at all.
 */
export function MediaGallery({
  items,
  alt,
}: {
  items: MediaItem[];
  alt: string;
}) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  if (items.length === 0) return null;
  const single = items.length === 1;

  return (
    <div className="w-full">
      <div
        ref={trackRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (idx !== active) setActive(idx);
        }}
        className={`momentum-scroll flex w-full ${
          single ? "overflow-hidden" : "snap-x snap-mandatory overflow-x-auto"
        }`}
        style={{ scrollbarWidth: "none" }}
      >
        {items.map((item, i) => (
          <div
            key={`${item.url}-${i}`}
            className={`brand-grade aspect-square w-full shrink-0 overflow-hidden bg-muted ${
              single ? "" : "snap-center"
            }`}
          >
            {item.kind === "video" ? (
              <video
                src={item.url}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full object-contain"
              />
            ) : (
              <img
                src={item.url}
                alt={alt}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                className="h-full w-full object-contain"
              />
            )}
          </div>
        ))}
      </div>


      {items.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {items.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === active ? "w-4 bg-primary" : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
