import { isNativeShell, REMOTE_SERVER_FN_ORIGIN } from "./nativeServerFn";

/**
 * Server-side check (service role) for "does this phone already have a PIN?".
 * Uses the public HTTP route so it works identically on web and inside the
 * Capacitor native shell, where relative URLs have no server behind them.
 */
export async function hasLoginPinFor(phone: string, timeoutMs = 6000): Promise<boolean> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return false;

  const base = isNativeShell() ? REMOTE_SERVER_FN_ORIGIN : "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/public/has-login-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: digits }),
      credentials: "omit",
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { hasPin?: boolean };
    return data?.hasPin === true;
  } catch (err) {
    console.warn("[login] has-login-pin check failed", err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
