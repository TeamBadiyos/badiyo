import { supabase } from "@/integrations/supabase/client";

export const APP_VERSION = "1.0.0";

export const PLAY_STORE_ID = "com.badiyos.customer";
export const PLAY_STORE_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_STORE_ID}`;
const PLAY_STORE_MARKET_URL = `market://details?id=${PLAY_STORE_ID}`;

const SOFT_DISMISS_KEY = "badiyo.softUpdateDismissedAt";
const SOFT_DISMISS_MS = 24 * 60 * 60 * 1000;

function parse(v: string) {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}

/** Returns true if `current` is lower than `min`. */
export function isBelow(current: string, min: string) {
  const c = parse(current);
  const m = parse(min);
  const len = Math.max(c.length, m.length);
  for (let i = 0; i < len; i++) {
    const cv = c[i] ?? 0;
    const mv = m[i] ?? 0;
    if (cv < mv) return true;
    if (cv > mv) return false;
  }
  return false;
}

export async function fetchMinSupportedVersion(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("min_supported_version")
      .eq("id", 1)
      .maybeSingle();
    if (error) return null;
    return data?.min_supported_version ?? null;
  } catch {
    return null;
  }
}

export type AppConfigVersions = {
  min_supported_version: string;
  current_version: string;
  latest_version_code: number;
  min_supported_version_code: number;
  play_store_url: string | null;
};

export async function fetchAppConfig(): Promise<AppConfigVersions | null> {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select(
        "min_supported_version, current_version, latest_version_code, min_supported_version_code, play_store_url",
      )
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return null;
    return data as AppConfigVersions;
  } catch {
    return null;
  }
}

/** Native build number (versionCode) + versionName, when running inside the app. */
export async function getInstalledVersion(): Promise<{
  code: number | null;
  name: string;
}> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return { code: null, name: APP_VERSION };
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const code = parseInt(String(info.build ?? ""), 10);
    return {
      code: Number.isFinite(code) ? code : null,
      name: info.version || APP_VERSION,
    };
  } catch {
    return { code: null, name: APP_VERSION };
  }
}

export type UpdateVerdict = {
  kind: "up_to_date" | "soft_update" | "hard_update";
  playStoreUrl: string;
};

/**
 * Decides whether an update prompt is needed. The integer versionCode wins when
 * the app runs natively; the dotted versionName is the web/browser fallback.
 */
export async function checkForUpdate(): Promise<UpdateVerdict> {
  const [config, installed] = await Promise.all([fetchAppConfig(), getInstalledVersion()]);
  const playStoreUrl = config?.play_store_url || PLAY_STORE_WEB_URL;
  // Fail open: no config, no prompt.
  if (!config) return { kind: "up_to_date", playStoreUrl };

  if (installed.code != null) {
    if (installed.code < (config.min_supported_version_code ?? 1))
      return { kind: "hard_update", playStoreUrl };
    if (installed.code < (config.latest_version_code ?? 1))
      return { kind: "soft_update", playStoreUrl };
    return { kind: "up_to_date", playStoreUrl };
  }

  if (config.min_supported_version && isBelow(installed.name, config.min_supported_version))
    return { kind: "hard_update", playStoreUrl };
  if (config.current_version && isBelow(installed.name, config.current_version))
    return { kind: "soft_update", playStoreUrl };
  return { kind: "up_to_date", playStoreUrl };
}

/** Opens the Play Store app, falling back to the web listing. */
export function openPlayStore(webUrl: string = PLAY_STORE_WEB_URL) {
  try {
    const fallback = () => window.open(webUrl, "_blank", "noreferrer");
    const timer = setTimeout(fallback, 800);
    const onHide = () => clearTimeout(timer);
    document.addEventListener("visibilitychange", onHide, { once: true });
    window.location.href = PLAY_STORE_MARKET_URL;
  } catch {
    window.open(webUrl, "_blank", "noreferrer");
  }
}

export function isSoftUpdateSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(SOFT_DISMISS_KEY);
    if (!raw) return false;
    const at = parseInt(raw, 10);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < SOFT_DISMISS_MS;
  } catch {
    return false;
  }
}

export function snoozeSoftUpdate() {
  try {
    localStorage.setItem(SOFT_DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}
