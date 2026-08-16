// ⚠️ HIGH RISK OF REVERT ⚠️
// This file has silently reverted during syncs before, taking the status-bar
// fix with it. Guarded by scripts/check-capacitor-config.ts — if that check
// fails, this file lost `plugins.StatusBar.overlaysWebView: false`, the green
// background colors, or the `server.url: "https://user.badiyos.com"` live
// server URL. Re-apply rather than relaxing the test.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.badiyos.customer",
  appName: "badiyos",
  webDir: "dist/client",
  backgroundColor: "#00B97A",
  // TRUE LIVE MODE: the WebView loads the app directly from
  // https://user.badiyos.com at runtime. Every Lovable publish is reflected the
  // next time the app is opened/reloaded, with no new APK build required for
  // web-layer changes. The https scheme keeps the WebView in a secure context
  // so geolocation works and the Google Maps referrer allowlist passes.
  server: {
    url: "https://user.badiyos.com",
    androidScheme: "https",
    iosScheme: "https",
    // Cold start with zero connectivity: the WebView would otherwise show a
    // blank/white page or the system "webpage not available" error. This
    // bundled page renders the branded no-internet screen and auto-recovers.
    errorPath: "offline.html",
  },
  android: {
    backgroundColor: "#00B97A",
  },
  ios: {
    backgroundColor: "#00B97A",
  },
  plugins: {
    StatusBar: {
      backgroundColor: "#00B97A",
      style: "DARK", // light content on the green bar
      // Keep the WebView BELOW the status bar. Android WebViews do not expose
      // the status bar height through env(safe-area-inset-top), so overlaying
      // would make headers sit under the clock/notch.
      overlaysWebView: false,
    },
    SplashScreen: {
      backgroundColor: "#00B97A",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
