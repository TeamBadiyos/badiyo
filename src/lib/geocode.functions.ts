import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export type ReverseGeocodeResult = {
  formatted_address: string;
  area: string | null;
  city: string | null;
};

export const reverseGeocode = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<ReverseGeocodeResult> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!LOVABLE_API_KEY || !GOOGLE_MAPS_API_KEY) {
      throw new Error("Missing Google Maps connector credentials");
    }
    const url = `https://connector-gateway.lovable.dev/google_maps/maps/api/geocode/json?latlng=${data.lat},${data.lng}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAPS_API_KEY,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Geocoding failed [${res.status}]: ${body}`);
    }
    const json = (await res.json()) as {
      status: string;
      results?: Array<{
        formatted_address: string;
        address_components: Array<{
          long_name: string;
          short_name: string;
          types: string[];
        }>;
      }>;
    };
    if (json.status !== "OK" || !json.results?.length) {
      const msg = (json as any).error_message || json.status || "No results";
      throw new Error(`Geocoding failed: ${msg}`);
    }
    const top = json.results[0];
    const findComponent = (types: string[]) =>
      top.address_components.find((c) => types.some((t) => c.types.includes(t)))
        ?.long_name ?? null;
    return {
      formatted_address: top.formatted_address,
      area:
        findComponent(["sublocality", "sublocality_level_1", "neighborhood"]) ??
        findComponent(["locality"]),
      city:
        findComponent(["locality"]) ??
        findComponent(["administrative_area_level_2"]),
    };
  });

// Places API (New) is blocked on this project's Google key
// (API_KEY_SERVICE_BLOCKED), so forward address search runs on the Geocoding
// API instead — see src/lib/addressSearch.ts and
// src/routes/api/public/geocode-search.ts.
