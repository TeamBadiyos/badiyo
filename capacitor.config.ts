import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.badiyos.customer",
  appName: "badiyos",
  webDir: "dist",
  backgroundColor: "#00B97A",
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
    },
    SplashScreen: {
      backgroundColor: "#00B97A",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
