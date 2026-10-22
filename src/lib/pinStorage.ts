// The login PIN is NEVER stored on the device. This module only removes
// legacy "badiyo.pin.*" entries written by older app versions.
const PREFIX = "badiyo.pin.";

export async function purgeLegacyDevicePins(): Promise<void> {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* noop */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (globalThis as any).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const mod = await import("@aparajita/capacitor-secure-storage");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = (mod as any).SecureStorage;
    if (!S) return;
    const all: string[] = await S.keys();
    for (const k of all ?? []) {
      if (typeof k === "string" && k.startsWith(PREFIX)) {
        try { await S.remove(k); } catch { /* noop */ }
      }
    }
  } catch {
    /* noop */
  }
}
