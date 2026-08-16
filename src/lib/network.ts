/**
 * Connectivity detection that works both in the browser and inside the
 * Capacitor native shell (@capacitor/network). Falls back to navigator.onLine
 * plus a lightweight reachability probe when the plugin is unavailable.
 */
import { Capacitor } from "@capacitor/core";

export type ConnectivityListener = (online: boolean) => void;

const isNative = () => Capacitor.isNativePlatform();

/** Cheap reachability check — navigator.onLine lies on captive portals. */
export async function probeReachable(timeoutMs = 6000): Promise<boolean> {
  if (typeof fetch === "undefined") return true;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(`/favicon.png?ping=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function getOnline(): Promise<boolean> {
  if (isNative()) {
    try {
      const { Network } = await import("@capacitor/network");
      const status = await Network.getStatus();
      return status.connected;
    } catch {
      /* fall through */
    }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return true;
}

/** Subscribe to connectivity changes. Returns an unsubscribe function. */
export function onConnectivityChange(cb: ConnectivityListener): () => void {
  let disposed = false;
  const cleanups: Array<() => void> = [];

  if (isNative()) {
    import("@capacitor/network")
      .then(async ({ Network }) => {
        if (disposed) return;
        const handle = await Network.addListener("networkStatusChange", (s) =>
          cb(s.connected),
        );
        cleanups.push(() => void handle.remove());
      })
      .catch(() => {
        /* ignore */
      });
  }

  if (typeof window !== "undefined") {
    const on = () => cb(true);
    const off = () => cb(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    cleanups.push(() => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    });
  }

  return () => {
    disposed = true;
    cleanups.forEach((fn) => fn());
  };
}
