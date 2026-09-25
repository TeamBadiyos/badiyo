// Business batching worker.
// Woken by the database (pg_net) whenever new batches are created, and by the
// courier sweeper tick. Guarded by the shared courier job secret in the vault.
// For each claimed batch it orders the stops, measures the road distance and
// asks the database to finalize (fare -> wallet -> courier order -> dispatch).
import { createFileRoute } from "@tanstack/react-router";

type Point = { lat: number; lng: number };
type Drop = { receiver_id: string; lat: number; lng: number };
type Batch = { batch_id: string; pickup: Point | null; drops: Drop[] };

/** Road distance through every point in order; falls back to straight line * 1.3. */
async function routeDistanceKm(points: Point[]): Promise<{ km: number; source: string }> {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  const loc = (p: Point) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  if (key && points.length >= 2) {
    try {
      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: loc(points[0]),
          destination: loc(points[points.length - 1]),
          intermediates: points.slice(1, -1).map(loc),
          travelMode: "TWO_WHEELER",
          routingPreference: "TRAFFIC_UNAWARE",
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { routes?: Array<{ distanceMeters?: number }> };
        const meters = json.routes?.[0]?.distanceMeters;
        if (typeof meters === "number" && meters > 0) {
          return { km: Math.round((meters / 1000) * 100) / 100, source: "routes" };
        }
      }
    } catch (err) {
      console.error("[business-batches] routes api failed", err);
    }
  }
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * 6371 * Math.asin(Math.sqrt(h));
  }
  return { km: Math.round(total * 1.3 * 100) / 100, source: "fallback" };
}

export const Route = createFileRoute("/api/public/business/process-batches")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-courier-job-secret") ?? "";
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: valid } = await supabaseAdmin.rpc("courier_verify_job_secret" as never, {
          _secret: provided,
        } as never);
        if (valid !== true) return new Response("Unauthorized", { status: 401 });

        const { data: claimed, error } = await supabaseAdmin.rpc(
          "business_claim_planning_batches" as never,
          { _limit: 5 } as never,
        );
        if (error) {
          console.error("[business-batches] claim failed", error);
          return new Response("claim-failed", { status: 500 });
        }

        const batches = (claimed ?? []) as unknown as Batch[];
        let dispatched = 0;
        let held = 0;
        let failed = 0;

        for (const batch of batches) {
          try {
            const pickup = batch.pickup;
            const drops = batch.drops ?? [];
            if (!pickup || drops.length === 0) {
              failed++;
              await supabaseAdmin.rpc("business_finalize_batch" as never, {
                _batch_id: batch.batch_id,
                _distance_km: 0,
                _distance_source: "fallback",
                _receiver_order: [],
              } as never);
              continue;
            }

            const { data: planned } = await supabaseAdmin.rpc("courier_plan_stops" as never, {
              _stops: [
                { key: "P1", type: "pickup", lat: pickup.lat, lng: pickup.lng },
                ...drops.map((d) => ({ key: d.receiver_id, type: "drop", lat: d.lat, lng: d.lng })),
              ],
            } as never);

            const order = ((planned ?? []) as unknown as Array<{ key: string; type: string }>)
              .filter((s) => s.type === "drop")
              .map((s) => s.key);
            const receiverOrder = order.length === drops.length ? order : drops.map((d) => d.receiver_id);

            const byId = new Map(drops.map((d) => [d.receiver_id, d]));
            const points: Point[] = [
              pickup,
              ...receiverOrder.map((id) => byId.get(id)!).filter(Boolean),
            ];
            const { km, source } = await routeDistanceKm(points);

            const { data: result } = await supabaseAdmin.rpc("business_finalize_batch" as never, {
              _batch_id: batch.batch_id,
              _distance_km: km,
              _distance_source: source,
              _receiver_order: receiverOrder,
            } as never);

            const res = result as { ok?: boolean; reason?: string } | null;
            if (res?.ok) dispatched++;
            else if (res?.reason === "LOW_BALANCE") held++;
            else failed++;
          } catch (err) {
            failed++;
            console.error("[business-batches] batch failed", batch.batch_id, err);
          }
        }

        return Response.json({ claimed: batches.length, dispatched, held, failed });
      },
    },
  },
});
