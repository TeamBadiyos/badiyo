/** Which main tab the Home shell shows. First open lands on Clean, then the last used tab. */
export type HomeTab = "clean" | "store" | "food" | "parcel";
export type NavTab = HomeTab | "rewards";

const KEY = "badiyos_home_tab";

export function readHomeTab(): HomeTab {
  if (typeof window === "undefined") return "clean";
  const v = window.localStorage.getItem(KEY);
  return v === "store" || v === "food" || v === "clean" || v === "parcel" ? v : "clean";
}

export function writeHomeTab(tab: HomeTab) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, tab);
}
