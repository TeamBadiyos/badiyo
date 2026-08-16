/**
 * Guard for capacitor.config.ts, a file that has silently reverted on syncs and
 * taken the status-bar / Google Maps fixes with it. Runs before build:capacitor.
 */
import config from "../capacitor.config";

const failures: string[] = [];
const expect = (label: string, actual: unknown, wanted: unknown) => {
  if (actual !== wanted)
    failures.push(`${label}: expected ${String(wanted)}, got ${String(actual)}`);
};

expect("plugins.StatusBar.overlaysWebView", config.plugins?.StatusBar?.overlaysWebView, false);
expect("plugins.StatusBar.backgroundColor", config.plugins?.StatusBar?.backgroundColor, "#00B97A");
expect("backgroundColor", config.backgroundColor, "#00B97A");
expect("android.backgroundColor", config.android?.backgroundColor, "#00B97A");
expect("server.hostname", config.server?.hostname, "user.badiyos.com");
expect("server.androidScheme", config.server?.androidScheme, "https");
expect("webDir", config.webDir, "dist/client");

if (failures.length) {
  console.error("capacitor.config.ts regressed:\n - " + failures.join("\n - "));
  process.exit(1);
}
console.log("capacitor.config.ts OK");
