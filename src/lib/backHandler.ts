// Global back-press coordination for native Android hardware/gesture back.
// Overlays (sheets, modals, in-flow sub-screens) push a handler while open;
// the topmost handler runs first so back closes overlays before navigating.

type Handler = () => void;

const overlayStack: Handler[] = [];

export function pushBackHandler(handler: Handler): () => void {
  overlayStack.push(handler);
  return () => {
    const i = overlayStack.lastIndexOf(handler);
    if (i >= 0) overlayStack.splice(i, 1);
  };
}

export function hasOverlayHandler(): boolean {
  return overlayStack.length > 0;
}

export function runTopOverlayHandler(): boolean {
  const h = overlayStack.pop();
  if (h) {
    try {
      h();
    } catch (e) {
      console.error("back overlay handler failed:", e);
    }
    return true;
  }
  return false;
}

let initialized = false;
let rootHandler: (() => void) | null = null;

export function setRootBackHandler(fn: (() => void) | null) {
  rootHandler = fn;
}

export async function initNativeBackButton() {
  if (initialized) return;
  initialized = true;
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { App } = await import("@capacitor/app");
    App.addListener("backButton", () => {
      if (runTopOverlayHandler()) return;
      if (rootHandler) rootHandler();
      else App.exitApp();
    });
  } catch (e) {
    console.error("native back init failed:", e);
  }
}

import { useEffect, useRef } from "react";
/** Register a back handler while `active` is true (topmost wins). */
export function useBackHandler(active: boolean, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => ref.current());
  }, [active]);
}
