export type Coords = { lat: number; lng: number };

/** Thrown when the OS refused (or the user denied) the location permission. */
export class LocationPermissionError extends Error {
  readonly permanentlyDenied: boolean;
  constructor(message: string, permanentlyDenied = false) {
    super(message);
    this.name = "LocationPermissionError";
    this.permanentlyDenied = permanentlyDenied;
  }
}

/**
 * Resolve the device's current coordinates.
 *
 * On native we ALWAYS call requestPermissions() when the status is anything
 * other than "granted" — Android reports "denied" / "prompt-with-rationale"
 * before the user has ever been asked, so checking alone silently no-ops.
 */
export async function getCurrentCoords(): Promise<Coords> {
  if (typeof window === "undefined") {
    throw new Error("Location is only available in the app.");
  }

  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import("@capacitor/geolocation");

    let status: string | undefined;
    try {
      status = (await Geolocation.checkPermissions()).location;
    } catch (e) {
      console.warn("[geo] checkPermissions failed, requesting anyway:", e);
    }
    console.info("[geo] permission status before request:", status);

    if (status !== "granted") {
      let requested: string | undefined;
      try {
        requested = (
          await Geolocation.requestPermissions({ permissions: ["location"] })
        ).location;
      } catch (e) {
        console.error("[geo] requestPermissions threw:", e);
        throw new LocationPermissionError(
          "Location permission needed to detect your address.",
        );
      }
      console.info("[geo] permission status after request:", requested);
      if (requested !== "granted") {
        throw new LocationPermissionError(
          "Location permission needed to detect your address.",
          requested === "denied" && status === "denied",
        );
      }
    }

    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      console.error("[geo] getCurrentPosition failed:", e);
      throw new Error(
        "Couldn't get your location. Turn on GPS/Location and try again.",
      );
    }
  }

  return new Promise<Coords>((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location is not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        reject(
          err.code === err.PERMISSION_DENIED
            ? new LocationPermissionError(
                "Location permission needed to detect your address.",
              )
            : new Error(err.message || "Couldn't get your location."),
        ),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

/**
 * Best-effort deep link into the OS app settings so the user can flip the
 * location permission back on. Returns false when the platform can't do it.
 */
export async function openAppSettings(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return false;
    const { NativeSettings, AndroidSettings, IOSSettings } = (await import(
      "capacitor-native-settings"
    )) as any;
    await NativeSettings.open({
      optionAndroid: AndroidSettings.ApplicationDetails,
      optionIOS: IOSSettings.App,
    });
    return true;
  } catch (e) {
    console.warn("[geo] openAppSettings unavailable:", e);
    return false;
  }
}
