import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

/**
 * Where Supabase sends the user back after Google sign-in. In the native
 * shell the WebView is already served from this https origin, and the Android
 * App Link intent filter (see public/.well-known/assetlinks.json) makes the
 * system hand this URL back to the app instead of leaving the user in Chrome.
 */
const NATIVE_REDIRECT = "https://user.badiyos.com/";

/**
 * Starts Google OAuth.
 *
 * Web: normal same-tab redirect.
 * Native: opens the provider URL in Capacitor's in-app browser (Custom Tab)
 * and closes it as soon as the deep link comes back into the app, then
 * exchanges the PKCE code for a session.
 */
export async function signInWithGoogle(): Promise<void> {
  const native = Capacitor.isNativePlatform();

  if (!native) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    return;
  }

  const { App } = await import("@capacitor/app");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_REDIRECT,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Could not start Google sign-in");

  // Fallback for APKs built before @capacitor/browser was synced in: the
  // WebView is served from https://user.badiyos.com, so navigating it to the
  // OAuth URL and back works too — Supabase exchanges the ?code= on return
  // (detectSessionInUrl). Newer builds use the in-app browser instead.
  if (!Capacitor.isPluginAvailable("Browser")) {
    window.location.href = data.url;
    return;
  }
  const { Browser } = await import("@capacitor/browser");

  // Handle the return trip before opening the browser, so a fast redirect
  // can't race us.
  const sub = await App.addListener("appUrlOpen", async ({ url }) => {
    try {
      const parsed = new URL(url);
      const code =
        parsed.searchParams.get("code") ??
        new URLSearchParams(parsed.hash.replace(/^#/, "")).get("code");
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      }
    } catch (err) {
      console.error("Google sign-in callback failed:", err);
    } finally {
      await Browser.close().catch(() => {});
      await sub.remove();
    }
  });

  await Browser.open({ url: data.url, presentationStyle: "popover" });
}
