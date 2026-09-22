/**
 * Supabase API host.
 *
 * The project is also reachable on its own domain (https://api.badiyos.com),
 * which is verified and serves REST, Auth, Storage, Realtime and Functions for
 * the same project ref. Some ISP / WiFi DNS setups in India block or fail to
 * resolve `*.supabase.co`, which made login silently break on those networks.
 *
 * The platform injects SUPABASE_URL / VITE_SUPABASE_URL with the default
 * `*.supabase.co` value and those injected values win over .env, so the host is
 * normalised here instead. Any other URL (self-hosted, local) is left alone.
 */
export const SUPABASE_API_URL = "https://api.badiyos.com";

export function resolveSupabaseUrl(raw?: string | null): string {
  if (!raw) return SUPABASE_API_URL;
  try {
    const host = new URL(raw).hostname;
    return host.endsWith(".supabase.co") ? SUPABASE_API_URL : raw;
  } catch {
    return SUPABASE_API_URL;
  }
}
