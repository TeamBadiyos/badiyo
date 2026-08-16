/**
 * Native status bar handling.
 *
 * Android WebViews only report `env(safe-area-inset-top)` for display cutouts —
 * never for the status bar itself. So on a device where the WebView is drawn
 * edge-to-edge (Android 15 / targetSdk 35 forces this), CSS alone can't push
 * the header below the status bar and the content overlaps it.
 *
 * The fix is to tell the StatusBar plugin NOT to overlay the WebView, so the
 * native layout reserves the status bar height and the WebView starts below it.
 * The existing `app-safe-shell` env() padding stays in place as a fallback for
 * notched devices / iOS (it resolves to 0 once the overlay is disabled, so
 * there is no double padding).
 *
 * Web builds are unaffected: everything below is a no-op off native.
 */
import { isNativeShell } from "./nativeServerFn";

const BRAND_GREEN = "#00B97A";

let initialized = false;

export async function initStatusBar(): Promise<void> {
  if (initialized || !isNativeShell()) return;
  initialized = true;

  // Guarantee a minimum top inset on native even when the platform reports
  // env(safe-area-inset-top) = 0 (common on Android WebViews).
  document.documentElement.style.setProperty("--safe-top-min", "12px");


  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");

    // Content sits BELOW the status bar (no overlap on notched or standard devices).
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: BRAND_GREEN });
    // Light icons/text on the green bar.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.show();
  } catch (err) {
    // Plugin missing (web/dev) or platform without a status bar — ignore.
    console.warn("[statusBar] init skipped:", err);
  }
}
