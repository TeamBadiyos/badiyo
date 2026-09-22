import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const pointSchema = z.object({
  lat: z.number().min(17.5).max(19.5),
  lng: z.number().min(75.5).max(77.5),
});

const routeSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  mode: z.enum(["TWO_WHEELER", "DRIVE"]),
});

type RoadRoute = {
  encodedPolyline: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
};

const routeCache = new Map<string, { expiresAt: number; value: RoadRoute | null }>();

function roundedPoint(point: { lat: number; lng: number }) {
  return `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
}

export const fetchTrackingRoadRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => routeSchema.parse(input))
  .handler(async ({ data }): Promise<RoadRoute | null> => {
    const cacheKey = `${data.mode}:${roundedPoint(data.origin)}:${roundedPoint(data.destination)}`;
    const cached = routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const lovableApiKey = process.env["LOVABLE_API_KEY"];
    const googleMapsApiKey = process.env["GOOGLE_MAPS_API_KEY"];
    if (!lovableApiKey || !googleMapsApiKey) {
      console.error("[tracking-route] Google Maps connection is not configured");
      return null;
    }

    const response = await fetch(
      "https://connector-gateway.lovable.dev/google_maps/routes/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "X-Connection-Api-Key": googleMapsApiKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask":
            "routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration",
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: { latitude: data.origin.lat, longitude: data.origin.lng },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: data.destination.lat,
                longitude: data.destination.lng,
              },
            },
          },
          travelMode: data.mode,
          routingPreference: "TRAFFIC_UNAWARE",
          polylineQuality: "OVERVIEW",
          polylineEncoding: "ENCODED_POLYLINE",
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 403) {
        console.error(`[tracking-route] Google Maps key restriction (403): ${body}`);
      } else {
        console.error(`[tracking-route] Routes request failed [${response.status}]: ${body}`);
      }
      routeCache.set(cacheKey, { expiresAt: Date.now() + 30_000, value: null });
      return null;
    }

    const payload = (await response.json()) as {
      routes?: Array<{
        polyline?: { encodedPolyline?: string };
        distanceMeters?: number;
        duration?: string;
      }>;
    };
    const route = payload.routes?.[0];
    const encodedPolyline = route?.polyline?.encodedPolyline;
    if (!encodedPolyline) {
      routeCache.set(cacheKey, { expiresAt: Date.now() + 30_000, value: null });
      return null;
    }

    const value: RoadRoute = {
      encodedPolyline,
      distanceMeters: route.distanceMeters ?? null,
      durationSeconds: route.duration ? Number.parseFloat(route.duration) : null,
    };
    routeCache.set(cacheKey, { expiresAt: Date.now() + 2 * 60_000, value });
    if (routeCache.size > 200) {
      const oldestKey = routeCache.keys().next().value as string | undefined;
      if (oldestKey) routeCache.delete(oldestKey);
    }
    return value;
  });