/**
 * Capacitor static build support.
 *
 * The Capacitor bundle (`bun run build:capacitor` -> `dist/client`) is a pure
 * client-rendered SPA served from the native WebView origin
 * (`https://localhost` on Android, `capacitor://localhost` on iOS). There is no
 * local server, so TanStack Start server functions — which are called at
 * relative paths like `/_serverFn/<id>` — must be sent to the live deployment
 * instead.
 *
 * On the regular web deployment `isNativeShell()` is always false, so calls
 * stay same-origin and behave exactly as before.
 */

/** Live web deployment that hosts the server functions. */
export const REMOTE_SERVER_FN_ORIGIN =
  (import.meta.env?.["VITE_SERVER_FN_ORIGIN"] as string | undefined) ??
  "https://user.badiyos.com";

/** Origins the native WebView can load the SPA from. */
export const NATIVE_ORIGINS = [
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
] as const;

/** True only inside the Capacitor native shell (Capacitor injects this global). */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/** Rewrites a same-origin server-function URL onto the live deployment. */
export function toRemoteServerFnUrl(url: string): string {
  try {
    const parsed = new URL(url, `${REMOTE_SERVER_FN_ORIGIN}/`);
    const remote = new URL(REMOTE_SERVER_FN_ORIGIN);
    parsed.protocol = remote.protocol;
    parsed.host = remote.host;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Custom fetch for server-function RPC calls. Passed to `createStart` via
 * `serverFns.fetch`; only ever used on the client.
 */
export const serverFnFetch: typeof fetch = (input, init) => {
  if (!isNativeShell()) return fetch(input, init);

  const original =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const target = toRemoteServerFnUrl(original);
  if (target === original) return fetch(input, init);

  // Cross-origin: auth travels as a bearer header (attachSupabaseAuth), not cookies.
  if (input instanceof Request) {
    return fetch(new Request(target, input), { credentials: "omit", ...init });
  }
  return fetch(target, { ...init, credentials: "omit" });
};
