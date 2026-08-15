// Thin, safe wrapper around Capacitor Haptics.
// No-ops on web (falls back to navigator.vibrate when available).

type Style = "light" | "medium" | "heavy";

let nativeChecked = false;
let isNative = false;

async function checkNative(): Promise<boolean> {
  if (nativeChecked) return isNative;
  nativeChecked = true;
  try {
    const { Capacitor } = await import("@capacitor/core");
    isNative = Capacitor.isNativePlatform();
  } catch {
    isNative = false;
  }
  return isNative;
}

function webVibrate(ms: number) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  } catch {
    /* ignore */
  }
}

export async function hapticImpact(style: Style = "light") {
  try {
    if (await checkNative()) {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      const map = {
        light: ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy: ImpactStyle.Heavy,
      } as const;
      await Haptics.impact({ style: map[style] });
      return;
    }
  } catch {
    /* fall through */
  }
  webVibrate(style === "heavy" ? 25 : style === "medium" ? 15 : 8);
}

export async function hapticSelection() {
  try {
    if (await checkNative()) {
      const { Haptics } = await import("@capacitor/haptics");
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      await Haptics.selectionEnd();
      return;
    }
  } catch {
    /* fall through */
  }
  webVibrate(5);
}

export async function hapticNotification(type: "success" | "warning" | "error" = "success") {
  try {
    if (await checkNative()) {
      const { Haptics, NotificationType } = await import("@capacitor/haptics");
      const map = {
        success: NotificationType.Success,
        warning: NotificationType.Warning,
        error: NotificationType.Error,
      } as const;
      await Haptics.notification({ type: map[type] });
      return;
    }
  } catch {
    /* fall through */
  }
  webVibrate(type === "error" ? 40 : 20);
}
