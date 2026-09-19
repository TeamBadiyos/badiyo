import type { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";

/**
 * Remembers the app's public catalogue between launches, so Home paints from
 * the last known content immediately and refreshes quietly in the background
 * instead of showing an empty screen on every cold start.
 *
 * Only non-personal, public config data is stored. Anything tied to the signed
 * in customer (addresses, bookings, wallet, rewards balances) is deliberately
 * left out, and the store is wiped on sign-out.
 */
export const QUERY_CACHE_KEY = "badiyo.queryCache.v1";

const PERSISTED_KEYS = new Set([
  "segments",
  "segment_services",
  "service_categories",
  "homepage_sections",
  "gst_percent",
]);

export function startQueryPersistence(queryClient: QueryClient) {
  if (typeof window === "undefined") return;
  try {
    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: QUERY_CACHE_KEY,
      throttleTime: 2000,
    });
    persistQueryClient({
      queryClient,
      persister,
      maxAge: 24 * 60 * 60 * 1000,
      buster: "v1",
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" && PERSISTED_KEYS.has(String(query.queryKey[0])),
      },
    });
  } catch {
    /* storage unavailable — the app just fetches as before */
  }
}

export function clearPersistedQueries() {
  try {
    window.localStorage.removeItem(QUERY_CACHE_KEY);
  } catch {
    /* ignore */
  }
}
