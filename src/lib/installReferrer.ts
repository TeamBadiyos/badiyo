/**
 * Google Play Install Referrer → referral code.
 *
 * Flow: invite link on a phone without the app → Play Store URL carries
 * `referrer=ref%3DCODE` → after install, the FIRST launch reads that string
 * back through the Play Install Referrer API and stores the code, so the
 * friend's signup is attributed even though they never opened the web page
 * inside the app.
 *
 * Native plugin: `@capgo/capacitor-install-referrer` (plugin id
 * `InstallReferrer`, method `getReferrer()`). It is registered BY NAME so the
 * web bundle stays dependency-free; when the native side is missing we log a
 * warning (never a silent no-op) and skip.
 *
 * See native/android/MANUAL_MERGE.md for the build step.
 */
import { registerPlugin, Capacitor } from "@capacitor/core";
import { isNativeShell } from "@/lib/nativeServerFn";
import { getStoredReferralCode, storeReferralCode } from "@/lib/referrals";

const DONE_KEY = "badiyo.installReferrerRead";
const ATTEMPTS_KEY = "badiyo.installReferrerAttempts";
/** Play Services can answer empty on the very first launch — retry before giving up. */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

type InstallReferrerPlugin = {
  getReferrer(options?: Record<string, unknown>): Promise<{
    referrer?: string | null;
    installReferrer?: string | null;
    [key: string]: unknown;
  }>;
};

const InstallReferrer = registerPlugin<InstallReferrerPlugin>("InstallReferrer");

/** `ref=CODE` (possibly URL-encoded, possibly among other utm_* params). */
export function parseReferralCodeFromReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  // Play may hand the value back still percent-encoded (referrer=ref%3DCODE).
  try {
    if (/%[0-9a-f]{2}/i.test(value)) value = decodeURIComponent(value);
  } catch {
    /* keep the raw value */
  }
  try {
    const params = new URLSearchParams(value.replace(/^\?/, ""));
    const code = params.get("ref") ?? params.get("code") ?? params.get("referral");
    if (code && code.trim()) return code.trim().toUpperCase();
  } catch {
    /* fall through */
  }
  const m = value.match(/(?:^|[?&])(?:ref|code|referral)=([^&#\s]+)/i);
  return m?.[1] ? decodeURIComponent(m[1]).trim().toUpperCase() : null;
}

function alreadyRead(): boolean {
  try {
    return window.localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markRead() {
  try {
    window.localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Reads the Play install referrer once per install and stores the referral
 * code if we don't already have one. Safe to call on every app start.
 */
export async function captureInstallReferrer(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (alreadyRead()) return null;

  let native = false;
  try {
    native = isNativeShell();
  } catch {
    native = false;
  }
  if (!native) return null;

  if (!Capacitor.isPluginAvailable("InstallReferrer")) {
    console.warn(
      "[installReferrer] native InstallReferrer plugin missing — Play Store install attribution is disabled. " +
        "Run `npm install @capgo/capacitor-install-referrer && npx cap sync android` (see native/android/MANUAL_MERGE.md).",
    );
    return null;
  }

  try {
    const result = await InstallReferrer.getReferrer();
    // Mark read even when empty: the value never changes for an install.
    markRead();
    const raw = result?.referrer ?? result?.installReferrer ?? null;
    const code = parseReferralCodeFromReferrer(typeof raw === "string" ? raw : null);
    if (!code) return null;
    if (getStoredReferralCode()) return null; // an explicit invite link wins
    storeReferralCode(code);
    return code;
  } catch (e) {
    console.warn("[installReferrer] getReferrer failed:", e);
    return null;
  }
}
