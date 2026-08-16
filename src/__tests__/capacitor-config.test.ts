import { describe, expect, it } from "vitest";
import config from "../../capacitor.config";

// capacitor.config.ts is known to revert on syncs. These assertions make the
// regression loud instead of only showing up on a physical device.
describe("capacitor.config.ts (high revert risk)", () => {
  it("keeps the WebView below the status bar", () => {
    expect(config.plugins?.StatusBar?.overlaysWebView).toBe(false);
  });

  it("keeps the brand green behind the status bar / splash", () => {
    expect(config.backgroundColor).toBe("#00B97A");
    expect(config.android?.backgroundColor).toBe("#00B97A");
    expect(config.plugins?.StatusBar?.backgroundColor).toBe("#00B97A");
  });

  it("keeps the referrer-allowlisted https origin for Google Maps", () => {
    expect(config.server?.hostname).toBe("user.badiyos.com");
    expect(config.server?.androidScheme).toBe("https");
  });

  it("points at the static Capacitor bundle", () => {
    expect(config.webDir).toBe("dist/client");
  });
});
