// Stable per-install device identifier. Generated once on first launch and
// kept in secure storage (Android Keystore via capacitor-secure-storage) with
// a localStorage fallback for the web preview.
const KEY = "badiyo.device_id";
const LABEL_KEY = "badiyo.device_label";

let cached: string | null = null;

async function ss() {
  // SecureStorage is a Capacitor proxy; returning it from an async function on
  // web triggers "SecureStorage.then() is not implemented". Use it on native
  // only, and wrap it so the proxy itself never crosses an await.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  try {
    const mod = await import("@aparajita/capacitor-secure-storage");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const S = (mod as any).SecureStorage;
    if (!S) return null;
    return {
      get: (k: string) => S.get(k),
      set: (k: string, v: string, a: boolean, b: boolean) => S.set(k, v, a, b),
    };
  } catch {
    return null;
  }
}

function newUuid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* noop */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const store = await ss();
  if (store) {
    try {
      const v = await store.get(KEY);
      if (typeof v === "string" && v.length >= 8) {
        cached = v;
        return v;
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const v = localStorage.getItem(KEY);
    if (v && v.length >= 8) {
      cached = v;
      return v;
    }
  } catch {
    /* noop */
  }

  const id = newUuid();
  cached = id;
  if (store) {
    try {
      await store.set(KEY, id, false, false);
    } catch {
      /* noop */
    }
  }
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* noop */
  }
  return id;
}

/** Human-friendly name for this device, shown on the device-limit screen. */
export function getDeviceLabel(): string {
  try {
    const stored = localStorage.getItem(LABEL_KEY);
    if (stored) return stored;
  } catch {
    /* noop */
  }
  let label = "This device";
  try {
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) label = "Android device";
    else if (/iPhone/i.test(ua)) label = "iPhone";
    else if (/iPad/i.test(ua)) label = "iPad";
    else if (/Mac OS X/i.test(ua)) label = "Mac browser";
    else if (/Windows/i.test(ua)) label = "Windows browser";
    else label = "Web browser";
  } catch {
    /* noop */
  }
  try {
    localStorage.setItem(LABEL_KEY, label);
  } catch {
    /* noop */
  }
  return label;
}
