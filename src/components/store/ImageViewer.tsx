import { createPortal } from "react-dom";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { useBackHandler } from "@/lib/backHandler";
import { StoreImage } from "./StoreImage";

/** Full-screen photo viewer with pinch / double-tap / button zoom and pan. */
export function ImageViewer({ path, alt, open, onClose }: { path: string | null | undefined; alt: string; open: boolean; onClose: () => void }) {
  useBackHandler(open, onClose);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-foreground" onClick={(e) => e.stopPropagation()}>
      <TransformWrapper minScale={1} maxScale={5} doubleClick={{ mode: "toggle", step: 1.5 }} wheel={{ step: 0.15 }} centerOnInit>
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <div className="absolute inset-x-0 top-0 z-10 flex justify-end p-4 pt-[calc(var(--app-safe-top,0px)+12px)]">
              <button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-background/20 text-background backdrop-blur">
                <X className="h-5 w-5" />
              </button>
            </div>
            <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
              <div className="flex h-full w-full items-center justify-center">
                <StoreImage path={path ?? null} alt={alt} size="full" className="!h-auto max-h-[85vh] w-full !rounded-none !bg-transparent !object-contain" />
              </div>
            </TransformComponent>
            <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center gap-3 p-4 pb-[calc(var(--app-safe-bottom,0px)+20px)]">
              {[
                { icon: Minus, fn: () => zoomOut(), l: "Zoom out" },
                { icon: RotateCcw, fn: () => resetTransform(), l: "Reset" },
                { icon: Plus, fn: () => zoomIn(), l: "Zoom in" },
              ].map(({ icon: I, fn, l }) => (
                <button key={l} type="button" aria-label={l} onClick={fn} className="flex h-11 w-11 items-center justify-center rounded-full bg-background/20 text-background backdrop-blur active:scale-90">
                  <I className="h-5 w-5" />
                </button>
              ))}
            </div>
          </>
        )}
      </TransformWrapper>
    </div>,
    document.body,
  );
}
