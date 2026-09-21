import { supabase } from "@/integrations/supabase/client";
import { isNetworkError } from "@/lib/networkError";

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
