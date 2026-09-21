// A dropped mobile connection makes supabase-js throw FunctionsFetchError
// ("Failed to send a request to the Edge Function") before the request ever
// reaches the server. Detect that so the app can retry and show plain wording.
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
