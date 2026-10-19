// Last few picked search locations, kept on the device.
import type { AddressSuggestion } from "./addressSearch";

const KEY = "badiyos_recent_places_v1";
const MAX = 5;

export function getRecentPlaces(): AddressSuggestion[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((s) => s?.lat != null && s?.lng != null) : [];
  } catch {
    return [];
  }
}

export function addRecentPlace(s: AddressSuggestion, lat: number, lng: number) {
  try {
    const item: AddressSuggestion = { ...s, id: `recent-${lat.toFixed(5)},${lng.toFixed(5)}`, lat, lng, placeId: null, distanceKm: null };
    const rest = getRecentPlaces().filter((r) => r.id !== item.id && r.title !== item.title);
    localStorage.setItem(KEY, JSON.stringify([item, ...rest].slice(0, MAX)));
  } catch {
    /* storage full / blocked */
  }
}

export function clearRecentPlaces() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
