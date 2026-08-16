/**
 * Native status bar handling.
 *
 * ROOT CAUSE OF THE RECURRING OVERLAP (Capacitor 8 / Android 15+):
 * Android 15 (API 35) enforces edge-to-edge for apps targeting SDK 35+, and it
 * IGNORES `StatusBar.setOverlaysWebView({ overlay: false })`. The WebView is
 * always drawn behind the status bar. Worse, an Android WebView only reports
 * `env(safe-area-inset-top)` for *display cutouts* — not for the status bar —
 * so on a flat-top phone the inset resolves to 0 and the header slides under
 * the clock even though `overlaysWebView: false` is still in capacitor.config.
 *
 * So we cannot rely on the plugin flag alone. Two layers:
 *  1. Keep `overlaysWebView: false` (still honoured on Android <= 14 / iOS).
 *  2. Measure the inset the platform actually reports and, when it is too
 *     small to clear a status bar, pin `--safe-top-min` to a real status-bar
 *     height (24dp ~= 24 CSS px, we use 28 for comfort).
 *
 * Web builds are unaffected: everything below is a no-op off native.
 */
import { isNativeShell } from "./nativeServerFn";

const BRAND_GREEN = "#00B97A";
/** Typical Android status bar is 24dp; 32 gives comfortable clearance on
 *  smaller devices / short reported insets. */
const ANDROID_STATUS_BAR_FALLBACK_PX = 32;

let initialized = false;

/** Reads the inset the platform actually reports for env(safe-area-inset-top). */
function measureReportedTopInset(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;visibility:hidden;height:env(safe-area-inset-top,0px);";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

function applyTopInset(): void {
  const reported = measureReportedTopInset();
  // If the platform reports a real cutout inset, trust it. Otherwise assume
  // the status bar is overlaying us (Android 15 edge-to-edge) and reserve a
  // real status-bar height.
  const min =
    reported >= ANDROID_STATUS_BAR_FALLBACK_PX ? 0 : ANDROID_STATUS_BAR_FALLBACK_PX;
  document.documentElement.style.setProperty("--safe-top-min", `${min}px`);
  console.info(
    `[statusBar] reported inset=${reported}px -> --safe-top-min=${min}px`,
  );
}

export async function initStatusBar(): Promise<void> {
  if (initialized || !isNativeShell()) return;
  initialized = true;

  applyTopInset();
  // Re-measure after rotation / window resize (inset changes on landscape).
  window.addEventListener("resize", applyTopInset);
  window.addEventListener("orientationchange", applyTopInset);

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");

    // Honoured on Android <= 14 and iOS; a no-op on Android 15+ edge-to-edge,
    // which is why the measured fallback above exists.
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: BRAND_GREEN });
    // Light icons/text on the green bar.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.show();
    // The overlay call can change the reported inset — re-measure after it.
    setTimeout(applyTopInset, 50);
  } catch (err) {
    // Plugin missing (web/dev) or platform without a status bar — ignore.
    console.warn("[statusBar] init skipped:", err);
  }
}
