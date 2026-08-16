import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.badiyos.customer",
  appName: "badiyos",
  webDir: "dist/client",
  backgroundColor: "#00B97A",
  // The Google Maps browser key is HTTP-referrer restricted. A default
  // Capacitor WebView serves from https://localhost / capacitor://localhost,
  // which is NOT in the allowlist -> "This page didn't load Google Maps
  // correctly". Serving the bundled files under the app's real https origin
  // makes the WebView send https://user.badiyos.com/ as the referrer, which
  // is already allowed. (androidScheme https is also required for secure
  // context APIs like geolocation.)
  server: {
    androidScheme: "https",
    iosScheme: "https",
    hostname: "user.badiyos.com",
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
