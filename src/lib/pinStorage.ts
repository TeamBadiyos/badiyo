// Secure per-phone PIN storage on the device. Backed by the Android Keystore
// via @aparajita/capacitor-secure-storage on native; falls back to
// localStorage on the web preview (biometric isn't available there anyway,
// so the stored PIN is never auto-retrieved without user typing).
const KEY = (phone: string) => `badiyo.pin.${phone.replace(/\D/g, "").slice(-10)}`;

async function ss() {
  // SecureStorage is native-only; on web its methods reject with
  // "SecureStorage.then() is not implemented on web".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  try {
    const mod = await import("@aparajita/capacitor-secure-storage");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod as any).SecureStorage ?? null;
  } catch {
    return null;
  }
}

export async function saveDevicePin(phone: string, pin: string): Promise<void> {
  const key = KEY(phone);
  const store = await ss();
  if (store) {
    try {
      await store.set(key, pin, false, false);
      return;
    } catch (e) {
      console.warn("SecureStorage set failed, falling back to localStorage", e);
    }
  }
  try {
    localStorage.setItem(key, pin);
  } catch {
    /* noop */
  }
}

export async function loadDevicePin(phone: string): Promise<string | null> {
  const key = KEY(phone);
  const store = await ss();
  if (store) {
    try {
      const v = await store.get(key);
      if (typeof v === "string" && /^\d{4}$/.test(v)) return v;
    } catch {
      /* fall through */
    }
  }
  try {
    const v = localStorage.getItem(key);
    return v && /^\d{4}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export async function clearDevicePin(phone: string): Promise<void> {
  const key = KEY(phone);
  const store = await ss();
  if (store) {
    try {
      await store.remove(key);
    } catch {
      /* noop */
    }
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
