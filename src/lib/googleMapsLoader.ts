/**
 * Single source of truth for loading the Google Maps JavaScript API.
 *
 * The browser key comes ONLY from the connector-injected environment variable
 * VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY. Never hardcode a key, and
 * never add a second <script> tag for maps.googleapis.com anywhere else —
 * loading the Maps JS API twice causes auth/loader conflicts.
 */
declare global {
  interface Window {
    google?: any;
    __badiyoInitMap?: () => void;
    gm_authFailure?: () => void;
  }
}

let mapsLoaderPromise: Promise<void> | null = null;
export let mapsAuthFailed = false;

export function getMapsBrowserKey(): string | undefined {
  return import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
    | string
    | undefined;
}

export function loadMapsScript(): Promise<void> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("no window"));
  if (window.google?.maps) return Promise.resolve();
  if (mapsLoaderPromise) return mapsLoaderPromise;

  const key = getMapsBrowserKey();
  if (!key) return Promise.reject(new Error("Google Maps browser key missing"));

  mapsLoaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-badiyo-gmaps="1"]',
    );
    if (existing) {
      const prev = window.__badiyoInitMap;
      window.__badiyoInitMap = () => {
        prev?.();
        resolve();
      };
      return;
    }
    window.__badiyoInitMap = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&callback=__badiyoInitMap`;
    s.async = true;
    s.defer = true;
    s.dataset.badiyoGmaps = "1";
    s.onerror = () => {
      mapsLoaderPromise = null;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(s);
  });
  return mapsLoaderPromise;
}
