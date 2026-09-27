// Business dispatch worker.
// Woken by the database (pg_net) when dispatch runs / trips are waiting, and by the
// courier sweeper tick. Guarded by the shared courier job secret in the vault.
// Per planning run: split drops into trips with Google Route Optimization
// (fallback: bearing groups), create each trip and finalize it
// (fare -> wallet -> courier order -> rider search).
import { createFileRoute } from "@tanstack/react-router";

type Point = { lat: number; lng: number };
type Drop = { receiver_id: string; lat: number; lng: number };
type Run = {
  run_id: string;
  trigger?: string;
  min_trip_drops?: number | null;
  max_drops: number;
  service_minutes: number;
  trip_fixed_cost?: number;
  per_km?: number;
  pickup: Point | null;
  drops: Drop[];
};
type RetryBatch = {
  batch_id: string;
  receiver_order: string[] | null;
  distance_km: number | null;
  distance_source: string | null;
  pickup: Point | null;
  drops: Drop[];
};
type Trip = { receivers: string[]; km: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const toRad = (d: number) => (d * Math.PI) / 180;
function haversineKm(a: Point, b: Point) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function pathKm(points: Point[]) {
  let t = 0;
  for (let i = 1; i < points.length; i++) t += haversineKm(points[i - 1], points[i]);
  return t;
}
function bearing(from: Point, to: Point) {
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Google OAuth (service account JWT, RS256 via Web Crypto) ----------
function b64url(data: ArrayBuffer | string) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function googleAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Google Route Optimization. Returns trips in route order plus skipped receivers. */
async function optimizeWithGoogle(run: Run): Promise<{ trips: Trip[]; skipped: string[] }> {
  const raw = process.env["GOOGLE_ROUTE_OPT_SA_JSON"];
  if (!raw) throw new Error("GOOGLE_ROUTE_OPT_SA_JSON not set");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string; project_id: string };
  const token = await googleAccessToken(sa);
  const pickup = run.pickup!;
  // Up to one vehicle per drop; each used trip costs trip_fixed_cost, so Google picks how many trips.
  const vehicles = run.drops.length;
  const fixedCost = Math.max(0, Number(run.trip_fixed_cost ?? 0));
  const loc = (p: Point) => ({ latitude: p.lat, longitude: p.lng });
  const body = {
    model: {
      shipments: run.drops.map((d) => ({
        label: d.receiver_id,
        deliveries: [{ arrivalLocation: loc(d), duration: `${run.service_minutes * 60}s` }],
        loadDemands: { drops: { amount: "1" } },
      })),
      vehicles: Array.from({ length: vehicles }, (_, i) => ({
        label: `trip-${i + 1}`,
        startLocation: loc(pickup),
        travelMode: "DRIVING",
        loadLimits: { drops: { maxLoad: String(run.max_drops) } },
        costPerHour: 100,
        fixedCost,
      })),
    },
    considerRoadTraffic: false,
  };
  const res = await fetch(`https://routeoptimization.googleapis.com/v1/projects/${sa.project_id}:optimizeTours`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`optimizeTours ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    routes?: Array<{
      vehicleIndex?: number;
      visits?: Array<{ shipmentIndex?: number; isPickup?: boolean }>;
      metrics?: { travelDistanceMeters?: number };
    }>;
    skippedShipments?: Array<{ index?: number }>;
  };
  const trips: Trip[] = [];
  for (const r of (json.routes ?? []).sort((a, b) => (a.vehicleIndex ?? 0) - (b.vehicleIndex ?? 0))) {
    const visits = (r.visits ?? []).filter((v) => !v.isPickup);
    if (visits.length === 0) continue;
    trips.push({
      receivers: visits.map((v) => run.drops[v.shipmentIndex ?? 0].receiver_id),
      km: round2((r.metrics?.travelDistanceMeters ?? 0) / 1000),
    });
  }
  const skipped = (json.skippedShipments ?? []).map((s) => run.drops[s.index ?? 0].receiver_id);
  return { trips, skipped };
}

/** Fallback: bearing groups from the pickup, ordered by courier_plan_stops, haversine x 1.3. */
async function fallbackTrips(admin: Admin, run: Run): Promise<Trip[]> {
  const pickup = run.pickup!;
  const max = run.max_drops;
  const near: Drop[] = [];
  const far: Array<Drop & { b: number }> = [];
  for (const d of run.drops) {
    if (haversineKm(pickup, d) <= 1) near.push(d);
    else far.push({ ...d, b: bearing(pickup, d) });
  }
  far.sort((a, b) => a.b - b.b);
  // start the sweep just after the widest angular gap
  if (far.length > 1) {
    let widest = -1;
    let start = 0;
    for (let i = 0; i < far.length; i++) {
      const next = far[(i + 1) % far.length];
      const gap = (next.b - far[i].b + 360) % 360;
      if (gap > widest) {
        widest = gap;
        start = (i + 1) % far.length;
      }
    }
    far.push(...far.splice(0, start));
  }
  const groups: Drop[][] = [];
  let cur: Array<Drop & { b: number }> = [];
  for (const d of far) {
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= max || (d.b - prev.b + 360) % 360 > 60)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length) groups.push(cur);
  for (const d of near) {
    let best = -1;
    let bestKm = Infinity;
    groups.forEach((g, i) => {
      if (g.length >= max) return;
      for (const x of g) {
        const km = haversineKm(d, x);
        if (km < bestKm) {
          bestKm = km;
          best = i;
        }
      }
    });
    if (best >= 0) groups[best].push(d);
    else groups.push([d]);
  }

  const trips: Trip[] = [];
  for (const g of groups) {
    const { data: planned } = await admin.rpc("courier_plan_stops", {
      _stops: [
        { key: "P1", type: "pickup", lat: pickup.lat, lng: pickup.lng },
        ...g.map((d) => ({ key: d.receiver_id, type: "drop", lat: d.lat, lng: d.lng })),
      ],
    });
    const order = ((planned ?? []) as Array<{ key: string; type: string }>)
      .filter((s) => s.type === "drop")
      .map((s) => s.key);
    const receivers = order.length === g.length ? order : g.map((d) => d.receiver_id);
    const byId = new Map(g.map((d) => [d.receiver_id, d]));
    trips.push({ receivers, km: round2(pathKm([pickup, ...receivers.map((id) => byId.get(id)!)]) * 1.3) });
  }
  return trips;
}

async function processRun(admin: Admin, run: Run) {
  if (!run.pickup || run.drops.length === 0) {
    await admin.rpc("business_complete_run", {
      _run_id: run.run_id, _method: "fallback", _total_km: 0, _skipped: [], _error: "NO_PICKUP_OR_DROPS",
    });
    return { trips: 0 };
  }
  let method = "google_route_opt";
  let trips: Trip[] = [];
  let skipped: string[] = [];
  let error: string | null = null;
  try {
    ({ trips, skipped } = await optimizeWithGoogle(run));
  } catch (err) {
    console.error("[business-dispatch] route optimization failed, using fallback", err);
    error = `route_opt: ${String(err).slice(0, 180)}`;
    method = "fallback";
    trips = await fallbackTrips(admin, run);
    skipped = [];
  }
  let total = 0;
  let n = 0;
  for (const t of trips) {
    n++;
    total += t.km;
    const { error: e } = await admin.rpc("business_create_trip", {
      _run_id: run.run_id,
      _trip_no: n,
      _receiver_order: t.receivers,
      _distance_km: t.km,
      _distance_source: method,
    });
    if (e) console.error("[business-dispatch] create trip failed", run.run_id, n, e);
  }
  await admin.rpc("business_complete_run", {
    _run_id: run.run_id,
    _method: method,
    _total_km: total,
    _skipped: skipped,
    _error: method === "fallback" ? error : null,
  });
  return { trips: n };
}

export const Route = createFileRoute("/api/public/business/process-batches")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-courier-job-secret") ?? "";
        if (!provided) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as Admin;

        const { data: valid } = await admin.rpc("courier_verify_job_secret", { _secret: provided });
        if (valid !== true) return new Response("Unauthorized", { status: 401 });

        // 1. New dispatch runs
        const { data: runs, error: runErr } = await admin.rpc("business_claim_planning_runs", { _limit: 3 });
        if (runErr) console.error("[business-dispatch] claim runs failed", runErr);
        let tripsCreated = 0;
        for (const run of (runs ?? []) as Run[]) {
          try {
            tripsCreated += (await processRun(admin, run)).trips;
          } catch (err) {
            console.error("[business-dispatch] run failed", run.run_id, err);
            await admin.rpc("business_complete_run", {
              _run_id: run.run_id, _method: "fallback", _total_km: 0, _skipped: [], _error: String(err).slice(0, 200),
            });
          }
        }

        // 2. Trips waiting to be finalized (e.g. retried after a wallet top-up)
        const { data: claimed } = await admin.rpc("business_claim_planning_batches", { _limit: 5 });
        let dispatched = 0;
        let held = 0;
        let failed = 0;
        for (const b of (claimed ?? []) as RetryBatch[]) {
          try {
            let order = b.receiver_order ?? [];
            let km = b.distance_km ?? 0;
            let source = b.distance_source ?? "fallback";
            if (order.length === 0 && b.pickup && b.drops.length) {
              order = b.drops.map((d) => d.receiver_id);
              km = round2(pathKm([b.pickup, ...b.drops]) * 1.3);
              source = "fallback";
            }
            const { data: result } = await admin.rpc("business_finalize_batch", {
              _batch_id: b.batch_id, _distance_km: km, _distance_source: source, _receiver_order: order,
            });
            const res = result as { ok?: boolean; reason?: string } | null;
            if (res?.ok) dispatched++;
            else if (res?.reason === "LOW_BALANCE") held++;
            else failed++;
          } catch (err) {
            failed++;
            console.error("[business-dispatch] batch failed", b.batch_id, err);
          }
        }

        return Response.json({ runs: (runs ?? []).length, trips: tripsCreated, dispatched, held, failed });
      },
    },
  },
});
