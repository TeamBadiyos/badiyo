import { useCallback, useEffect, useRef, useState } from "react";
import { WifiOff, RotateCw } from "lucide-react";
import { getOnline, onConnectivityChange, probeReachable } from "@/lib/network";

/**
 * Full-screen "no internet" state, Blinkit/Zomato style.
 * Mounted once at the app root. Shows whenever connectivity is lost and
 * auto-dismisses (reloading the app) as soon as the network comes back.
 */
export function OfflineGate() {
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);
  const wasOffline = useRef(false);

  const evaluate = useCallback(async () => {
    const online = await getOnline();
    if (!online) {
      wasOffline.current = true;
      setOffline(true);
      return false;
    }
    const reachable = await probeReachable();
    if (!reachable) {
      wasOffline.current = true;
      setOffline(true);
      return false;
    }
    setOffline(false);
    return true;
  }, []);

  const retry = useCallback(async () => {
    setChecking(true);
    const ok = await evaluate();
    setChecking(false);
    // Coming back from an offline state: reload so any failed initial
    // requests (data, images, scripts) are fetched again.
    if (ok && wasOffline.current && typeof window !== "undefined") {
      window.location.reload();
    }
  }, [evaluate]);

  useEffect(() => {
    void evaluate();
    const unsub = onConnectivityChange((online) => {
      if (online) {
        void retry(); // auto-recover, no tap needed
      } else {
        wasOffline.current = true;
        setOffline(true);
      }
    });
    return unsub;
  }, [evaluate, retry]);

  if (!offline) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-8 text-center">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
        <WifiOff className="h-11 w-11 text-primary" strokeWidth={1.8} />
      </div>
      <h1 className="mt-6 text-xl font-extrabold text-foreground">
        No internet connection
      </h1>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Lagta hai aapka internet band hai. Please check your connection and try
        again.
      </p>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={checking}
        className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-base font-bold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-60"
      >
        <RotateCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
        {checking ? "Checking…" : "Retry"}
      </button>
    </div>
  );
}

export default OfflineGate;
