import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseConfig, type FirebaseWebConfig } from "./firebaseConfig.functions";

let cachedConfig: FirebaseWebConfig | null | undefined;
let registered = false;
let lastRegisteredAt = 0;
let foregroundListenerAttached = false;

/**
 * Push notification payload convention:
 *   data: { route?: string, ...extras }
 * When the user taps a notification (or the in-app toast), we forward
 * `data.route` to the registered navigator, which can `push()` into it.
 */
export type PushNavigator = (route: string, data?: Record<string, unknown>) => void;

let navigator_: PushNavigator | null = null;
export function setPushNavigator(nav: PushNavigator | null) {
  navigator_ = nav;
}

function handleTap(data: Record<string, unknown> | undefined) {
  const route = typeof data?.route === "string" ? (data.route as string) : null;
  if (route && navigator_) {
    try {
      navigator_(route, data);
    } catch (e) {
      console.error("push navigator failed:", e);
    }
  }
}

async function loadConfig() {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    cachedConfig = await getFirebaseConfig();
  } catch (e) {
    console.error("Failed to load Firebase config:", e);
    cachedConfig = null;
  }
  return cachedConfig;
}

function encodeSwParams(cfg: FirebaseWebConfig) {
  const params = new URLSearchParams({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  });
  return params.toString();
}

async function saveToken(token: string, platform: "android" | "ios" | "web") {
  const { error } = await supabase.rpc("register_device_token", {
    p_fcm_token: token,
    p_platform: platform,
  });
  if (error) {
    console.error("register_device_token failed:", error);
    return;
  }
  lastRegisteredAt = Date.now();
}

/** Register FCM for the currently signed-in user. Safe to call multiple times. */
export async function registerPushForCurrentUser() {
  if (typeof window === "undefined") return;

  const { data: userRes } = await supabase.auth.getUser();
  const uid = userRes.user?.id;
  if (!uid) return;

  const { Capacitor } = await import("@capacitor/core");

  // Native (Android/iOS): use Capacitor PushNotifications plugin.
  if (Capacitor.isNativePlatform()) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const platform: "android" | "ios" =
        Capacitor.getPlatform() === "ios" ? "ios" : "android";

      if (!registered) {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== "granted") return;

        // Fires on initial registration AND on token refresh.
        await PushNotifications.addListener("registration", async (t) => {
          const token = t.value;
          if (!token) return;
          await saveToken(token, platform);
        });

        await PushNotifications.addListener("registrationError", (err) => {
          console.error("Push registration error:", err);
        });

        // Foreground notification while app is open — surface as toast
        // and allow tap-to-navigate via data.route.
        await PushNotifications.addListener("pushNotificationReceived", (n) => {
          const title = n.title ?? "Notification";
          const body = n.body ?? "";
          const data = (n.data ?? {}) as Record<string, unknown>;
          toast(title, {
            description: body,
            action:
              typeof data.route === "string"
                ? { label: "Open", onClick: () => handleTap(data) }
                : undefined,
          });
        });

        // User tapped a notification (from tray, app cold/warm start).
        await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
          handleTap((a.notification?.data ?? {}) as Record<string, unknown>);
        });

        await PushNotifications.register();
        registered = true;
      } else {
        // Re-register to force a fresh token event; the listener will save it.
        await PushNotifications.register();
      }

      // Staleness safety net: on app foreground, re-register if >24h.
      if (!foregroundListenerAttached) {
        foregroundListenerAttached = true;
        const { App } = await import("@capacitor/app");
        await App.addListener("appStateChange", async ({ isActive }) => {
          if (!isActive) return;
          if (Date.now() - lastRegisteredAt > 24 * 60 * 60 * 1000) {
            try {
              await PushNotifications.register();
            } catch (e) {
              console.error("foreground re-register failed:", e);
            }
          }
        });

        // Deep links from the native full-screen alarm screen:
        //   badiyos://open/booking/<id>
        await App.addListener("appUrlOpen", ({ url }) => {
          if (!url || !url.startsWith("badiyos://open")) return;
          const route = url.replace("badiyos://open", "") || "/";
          handleTap({ route });
        });
      }

    } catch (e) {
      console.error("Native push registration failed:", e);
    }
    return;
  }

  // Web fallback: Firebase Web SDK.
  if (registered) return;
  if (!("serviceWorker" in window.navigator) || !("Notification" in window)) return;

  const cfg = await loadConfig();
  if (!cfg) return;

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return;
    }
  }
  if (permission !== "granted") return;

  try {
    const { initializeApp, getApps } = await import("firebase/app");
    const { getMessaging, getToken, onMessage, isSupported } = await import(
      "firebase/messaging"
    );
    if (!(await isSupported())) return;

    const app =
      getApps()[0] ??
      initializeApp({
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        projectId: cfg.projectId,
        storageBucket: cfg.storageBucket,
        messagingSenderId: cfg.messagingSenderId,
        appId: cfg.appId,
        measurementId: cfg.measurementId,
      });

    const swReg = await window.navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${encodeSwParams(cfg)}`,
    );

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: cfg.vapidKey,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return;

    await saveToken(token, "web");

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "Notification";
      const body = payload.notification?.body ?? "";
      const data = (payload.data ?? {}) as Record<string, unknown>;
      toast(title, {
        description: body,
        action:
          typeof data.route === "string"
            ? { label: "Open", onClick: () => handleTap(data) }
            : undefined,
      });
    });

    registered = true;
  } catch (e) {
    console.error("Push registration failed:", e);
  }
}
