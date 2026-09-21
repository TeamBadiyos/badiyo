import { supabase } from "@/integrations/supabase/client";

// A dropped mobile connection makes supabase-js throw FunctionsFetchError
// ("Failed to send a request to the Edge Function") before the request ever
// reaches the server. That is a network blip, not an app error, so retry a
// couple of times with a short backoff before surfacing anything to the user.
export function isNetworkError(err: unknown): boolean {
  const name = (err as { name?: unknown })?.name;
  if (name === "FunctionsFetchError" || name === "AbortError") return true;
  const msg = String((err as { message?: unknown })?.message ?? "").toLowerCase();
  return (
    msg.includes("failed to send a request") ||
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  );
}

export const NETWORK_ERROR_MESSAGE =
  "Network problem. Check your internet connection and try again.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls a Supabase edge function, retrying only when the request never made it
 * to the server. Real server responses (wrong OTP, rate limits) are returned
 * as-is on the first attempt.
 */
export async function invokeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
  { retries = 2, backoffMs = 700 }: { retries?: number; backoffMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(name, { body });
      if (error) throw error;
      return data as T;
    } catch (err) {
      lastErr = err;
      if (!isNetworkError(err) || attempt === retries) break;
      console.warn(`[${name}] network retry ${attempt + 1}`, err);
      await sleep(backoffMs * (attempt + 1));
    }
  }
  throw lastErr;
}
