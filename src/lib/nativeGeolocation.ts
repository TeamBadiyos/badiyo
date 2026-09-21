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
 * Thrown when the device's location services (GPS master switch) are OFF.
 * Different from a permission denial: the user must flip the system toggle,
 * not the app permission, so we deep link to the Location settings page.
 */
export class LocationDisabledError extends Error {
  constructor(
    message = "Location is turned off on your phone. Turn it on to detect your address.",
  ) {
    super(message);
    this.name = "LocationDisabledError";
  }
}

/** Capacitor/Android throws a plain error when the GPS master switch is off. */
function looksLikeServicesOff(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "").toLowerCase();
  return (
    msg.includes("location services are not enabled") ||
    msg.includes("location services disabled") ||
    msg.includes("location disabled") ||
    msg.includes("location unavailable") ||
    msg.includes("provider") ||
    msg.includes("gps")
  );
}

/**
 * Resolve the device's current coordinates.
 *
 * On native we ALWAYS call requestPermissions() when the status is anything
 * other than "granted" — Android reports "denied" / "prompt-with-rationale"
 * before the user has ever been asked, so checking alone silently no-ops.
 *
 * checkPermissions() itself THROWS when the system location services are
 * disabled; that case surfaces as LocationDisabledError so the UI can offer
 * the "Turn on location" system dialog instead of an app-permission prompt.
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
      console.warn("[geo] checkPermissions failed:", e);
      if (looksLikeServicesOff(e)) throw new LocationDisabledError();
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
        if (looksLikeServicesOff(e)) throw new LocationDisabledError();
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

    // Two-tier read: a quick satellite fix first, then a network (Wi-Fi/cell)
    // fix so indoor users still get a usable position instead of a timeout.
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 8000,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      console.warn("[geo] high-accuracy fix failed, trying network fix:", e);
      if (looksLikeServicesOff(e)) throw new LocationDisabledError();
      try {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 12000,
        });
        return { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch (e2) {
        console.error("[geo] getCurrentPosition failed:", e2);
        if (looksLikeServicesOff(e2)) throw new LocationDisabledError();
        throw new LocationDisabledError();
      }
    }
  }

  const read = (highAccuracy: boolean, timeout: number) =>
    new Promise<Coords>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) =>
          reject(
            err.code === err.PERMISSION_DENIED
              ? new LocationPermissionError(
                  "Location permission needed to detect your address.",
                )
              : new Error(err.message || "Couldn't get your location."),
          ),
        { enableHighAccuracy: highAccuracy, timeout },
      );
    });

  if (!("geolocation" in navigator)) {
    throw new Error("Location is not supported on this device.");
  }
  try {
    return await read(true, 8000);
  } catch (e) {
    if (e instanceof LocationPermissionError) throw e;
    try {
      return await read(false, 12000);
    } catch {
      throw new LocationDisabledError();
    }
  }
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

/**
 * Deep link into the system Location settings (the GPS master switch).
 * Returns false when the platform can't do it (e.g. the browser).
 */
export async function openLocationSettings(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return false;
    const { NativeSettings, AndroidSettings, IOSSettings } = (await import(
      "capacitor-native-settings"
    )) as any;
    await NativeSettings.open({
      optionAndroid: AndroidSettings.Location,
      optionIOS: IOSSettings.LocationServices,
    });
    return true;
  } catch (e) {
    console.warn("[geo] openLocationSettings unavailable:", e);
    return false;
  }
}
