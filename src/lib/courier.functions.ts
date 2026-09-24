// Courier (Porter-type) server layer.
// All pricing, distance, dispatch and OTP work happens here or in the database.
// The client never supplies a fare: it is always recomputed server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const latLng = z.object({ lat: z.number(), lng: z.number() });

const quoteSchema = z.object({
  city: z.string().min(1).max(60),
  vehicle_type_id: z.string().uuid(),
  courier_type_id: z.string().uuid(),
  pickup: latLng,
  drop: latLng,
  weight_kg: z.number().min(0).max(500).default(0),
  coupon_code: z.string().max(40).optional(),
  pickup_count: z.number().int().min(1).max(20).optional(),
  drop_count: z.number().int().min(1).max(20).optional(),
  // Multi-stop: every stop in the planned order (first pickup ... last drop).
  route: z.array(latLng).min(2).max(40).optional(),
});

const createSchema = quoteSchema.extend({
  pickup_address: z.string().min(3).max(500),
  pickup_contact_name: z.string().min(1).max(80),
  pickup_contact_phone: z.string().min(10).max(15),
  drop_address: z.string().min(3).max(500),
  drop_contact_name: z.string().min(1).max(80),
  drop_contact_phone: z.string().min(10).max(15),
  package_description: z.string().max(500).optional(),
  prohibited_items_confirmed: z.literal(true),
  // Multi-stop (optional). Passed through unchanged; the database validates.
  stops: z.array(z.record(z.string(), z.unknown())).max(40).optional(),
  parcels: z.array(z.record(z.string(), z.unknown())).max(40).optional(),
});

const planStopsSchema = z.object({
  stops: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        type: z.enum(["pickup", "drop"]),
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .min(1)
    .max(40),
});

export const courierPlanStops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => planStopsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: planned, error } = await context.supabase.rpc("courier_plan_stops" as never, {
      _stops: data.stops,
    } as never);
    if (error) throw new Error(error.message);
    return planned as unknown as Array<{ key: string; type: "pickup" | "drop"; lat: number; lng: number }>;
  });

/** Road distance in km via Google Routes API; falls back to straight-line * 1.3. */
async function routeDistanceKm(
  pickup: { lat: number; lng: number },
  drop: { lat: number; lng: number },
): Promise<{ km: number; source: string }> {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (key) {
    try {
      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: pickup.lat, longitude: pickup.lng } } },
          destination: { location: { latLng: { latitude: drop.lat, longitude: drop.lng } } },
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
      console.error("[courier] routes api failed", err);
    }
  }
  const R = 6371;
  const dLat = ((drop.lat - pickup.lat) * Math.PI) / 180;
  const dLng = ((drop.lng - pickup.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((pickup.lat * Math.PI) / 180) *
      Math.cos((drop.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const straight = 2 * R * Math.asin(Math.sqrt(a));
  return { km: Math.round(straight * 1.3 * 100) / 100, source: "haversine" };
}

/** Road distance through every stop in order (Routes API waypoints). */
async function multiRouteDistanceKm(
  points: Array<{ lat: number; lng: number }>,
): Promise<{ km: number; source: string }> {
  if (points.length <= 2) return routeDistanceKm(points[0], points[points.length - 1]);
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  const loc = (p: { lat: number; lng: number }) => ({
    location: { latLng: { latitude: p.lat, longitude: p.lng } },
  });
  if (key) {
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
      console.error("[courier] multi-stop routes api failed", err);
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
  return { km: Math.round(total * 1.3 * 100) / 100, source: "haversine" };
}

function rpcError(message: string): never {
  throw new Error(message);
}

/** Validation failures become short, human sentences — never raw zod output. */
function parseFriendly<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.join(".") ?? "";
  if (path === "weight_kg") throw new Error("Please enter a valid parcel weight.");
  if (path.startsWith("pickup")) throw new Error("Please choose a valid pickup point.");
  if (path.startsWith("drop")) throw new Error("Please choose a valid drop point.");
  throw new Error("Some parcel details are missing. Please check and try again.");
}

type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

/** Both stops must sit inside a zone mapped to the parcel service. */
async function assertInCourierZone(
  admin: AdminClient,
  point: { lat: number; lng: number },
  label: "Pickup" | "Drop",
) {
  const { data, error } = await admin.rpc("courier_check_serviceability" as never, {
    _lat: point.lat,
    _lng: point.lng,
  } as never);
  if (error) rpcError("We could not check the delivery area. Please try again.");
  const ok = (data as { serviceable?: boolean } | null)?.serviceable === true;
  if (!ok) {
    throw new Error(`${label} location is outside our delivery area right now.`);
  }
}

/** The parcel must fit the selected vehicle's configured limit. */
async function assertWeightAllowed(
  admin: AdminClient,
  vehicleTypeId: string,
  weightKg: number,
) {
  const { data: vehicle } = await admin
    .from("courier_vehicle_types")
    .select("name, max_weight_kg, is_active")
    .eq("id", vehicleTypeId)
    .maybeSingle();
  if (!vehicle || vehicle.is_active === false) {
    throw new Error("This delivery vehicle is not available right now.");
  }
  const max = vehicle.max_weight_kg == null ? null : Number(vehicle.max_weight_kg);
  if (max != null && weightKg > max) {
    throw new Error(`${vehicle.name} can carry up to ${max} kg.`);
  }
}

export const courierQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parseFriendly(quoteSchema, data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertWeightAllowed(supabaseAdmin, data.vehicle_type_id, data.weight_kg);
    const multi = data.route && data.route.length > 2 ? data.route : null;
    if (multi) {
      for (const point of multi) await assertInCourierZone(supabaseAdmin, point, "Pickup");
    } else {
      await assertInCourierZone(supabaseAdmin, data.pickup, "Pickup");
      await assertInCourierZone(supabaseAdmin, data.drop, "Drop");
    }
    const { km, source } = multi
      ? await multiRouteDistanceKm(multi)
      : await routeDistanceKm(data.pickup, data.drop);

    const { data: quote, error } = await supabaseAdmin.rpc("courier_quote_internal" as never, {
      _customer_id: context.userId,
      _city: data.city,
      _vehicle_type_id: data.vehicle_type_id,
      _courier_type_id: data.courier_type_id,
      _distance_km: km,
      _weight_kg: data.weight_kg,
      _coupon_code: data.coupon_code ?? null,
      _pickup_count: data.pickup_count ?? 1,
      _drop_count: data.drop_count ?? 1,
    } as never);
    if (error) rpcError(error.message);
    return { ...(quote as Record<string, unknown>), distance_source: source };
  });

export const courierCreateOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parseFriendly(createSchema, data))
  .handler(async ({ data, context }) => {
    const keyId = process.env["RAZORPAY_KEY_ID"];
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keyId || !keySecret) throw new Error("Payments are not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertWeightAllowed(supabaseAdmin, data.vehicle_type_id, data.weight_kg);
    const stopPoints = (data.stops ?? [])
      .map((st) => ({ lat: Number(st["lat"]), lng: Number(st["lng"]) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    const multi = data.stops && stopPoints.length > 2 ? stopPoints : null;
    if (multi) {
      for (const point of multi) await assertInCourierZone(supabaseAdmin, point, "Pickup");
    } else {
      await assertInCourierZone(supabaseAdmin, data.pickup, "Pickup");
      await assertInCourierZone(supabaseAdmin, data.drop, "Drop");
    }
    const { km, source } = multi
      ? await multiRouteDistanceKm(multi)
      : await routeDistanceKm(data.pickup, data.drop);

    const { data: created, error } = await supabaseAdmin.rpc("courier_create_order" as never, {
      _customer_id: context.userId,
      _payload: {
        city: data.city,
        vehicle_type_id: data.vehicle_type_id,
        courier_type_id: data.courier_type_id,
        distance_km: km,
        distance_source: source,
        weight_kg: data.weight_kg,
        coupon_code: data.coupon_code ?? null,
        pickup_lat: data.pickup.lat,
        pickup_lng: data.pickup.lng,
        pickup_address: data.pickup_address,
        pickup_contact_name: data.pickup_contact_name,
        pickup_contact_phone: data.pickup_contact_phone,
        drop_lat: data.drop.lat,
        drop_lng: data.drop.lng,
        drop_address: data.drop_address,
        drop_contact_name: data.drop_contact_name,
        drop_contact_phone: data.drop_contact_phone,
        package_description: data.package_description ?? null,
        prohibited_items_confirmed: true,
        ...(data.stops ? { stops: data.stops } : {}),
        ...(data.parcels ? { parcels: data.parcels } : {}),
      },
    } as never);
    if (error) rpcError(error.message);

    const result = created as { order_id: string; quote: { total_amount: number } };
    const amountPaise = Math.round(Number(result.quote.total_amount) * 100);

    // Fully discounted parcel: nothing to charge. Razorpay rejects a zero
    // amount, so confirm and dispatch the order straight away.
    if (amountPaise <= 0) {
      const freeOrderId = `free_courier_${result.order_id}`.slice(0, 40);
      await supabaseAdmin
        .from("courier_orders")
        .update({ razorpay_order_id: freeOrderId })
        .eq("id", result.order_id);
      await markCourierPaid(result.order_id, freeOrderId);
      return {
        order_id: result.order_id,
        quote: result.quote,
        razorpay_order_id: freeOrderId,
        amount: 0,
        key_id: keyId,
        free: true as const,
      };
    }


    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const rzRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: `courier_${result.order_id}`.slice(0, 40),
        notes: { purpose: "courier", courier_order_id: result.order_id },
      }),
    });
    if (!rzRes.ok) {
      console.error("[courier] razorpay order failed", await rzRes.text());
      throw new Error("Could not start the payment. Please try again.");
    }
    const rzOrder = (await rzRes.json()) as { id: string };

    await supabaseAdmin
      .from("courier_orders")
      .update({ razorpay_order_id: rzOrder.id })
      .eq("id", result.order_id);

    return {
      order_id: result.order_id,
      quote: result.quote,
      razorpay_order_id: rzOrder.id,
      amount: amountPaise,
      key_id: keyId,
      free: false as const,
    };
  });

export const courierConfirmPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        order_id: z.string().uuid(),
        razorpay_payment_id: z.string().min(3),
        razorpay_order_id: z.string().min(3),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const keyId = process.env["RAZORPAY_KEY_ID"];
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keyId || !keySecret) throw new Error("Payments are not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("courier_orders")
      .select("id, customer_id, total_amount, payment_status, razorpay_order_id, status")
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order || order.customer_id !== context.userId) throw new Error("Order not found");
    if (order.razorpay_order_id !== data.razorpay_order_id) throw new Error("Payment mismatch");

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(data.razorpay_payment_id)}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!res.ok) throw new Error("Could not verify this payment");
    const payment = (await res.json()) as { amount?: number; status?: string; order_id?: string };
    if (payment.status !== "captured" && payment.status !== "authorized") {
      throw new Error("Payment not completed");
    }
    if (payment.order_id !== data.razorpay_order_id) throw new Error("Payment mismatch");
    if (payment.amount !== Math.round(Number(order.total_amount) * 100)) {
      throw new Error("Payment amount mismatch");
    }

    await markCourierPaid(data.order_id, data.razorpay_payment_id);
    return { ok: true };
  });

/** Marks a courier order paid and starts rider search. Safe to call twice. */
export async function markCourierPaid(orderId: string, paymentId: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order } = await supabaseAdmin
    .from("courier_orders")
    .select("id, status, payment_status, total_amount")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, reason: "not_found" as const };

  if (order.payment_status !== "paid") {
    await supabaseAdmin
      .from("courier_orders")
      .update({ payment_status: "paid", razorpay_payment_id: paymentId })
      .eq("id", orderId);
  }

  // Payment arrived after the order was already cancelled/expired: refund it.
  if (order.status === "CANCELLED") {
    await supabaseAdmin.rpc("courier_mark_refund_pending" as never, {
      _order_id: orderId,
      _amount: Number(order.total_amount),
      _reason: "late_payment_on_cancelled_order",
    } as never);
    return { ok: true, refunded: true };
  }

  await supabaseAdmin.rpc("courier_start_dispatch" as never, { _order_id: orderId } as never);
  return { ok: true };
}

/** Sends a courier OTP over WhatsApp using the existing AiSensy campaign setup. */
async function sendCourierOtp(phone: string, otp: string) {
  const apiKey = process.env["AISENSY_API_KEY"];
  const campaign =
    process.env["AISENSY_COURIER_OTP_CAMPAIGN"] ?? process.env["AISENSY_CAMPAIGN_NAME"];
  if (!apiKey || !campaign) {
    console.warn("[courier] WhatsApp OTP not configured; customer can read it in the app");
    return false;
  }
  const digits = phone.replace(/\D/g, "").slice(-10);
  try {
    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        campaignName: campaign,
        destination: `+91${digits}`,
        userName: digits,
        templateParams: [otp],
        buttons: [
          { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: otp }] },
        ],
      }),
    });
    if (!res.ok) console.error("[courier] AiSensy OTP send failed", await res.text());
    return res.ok;
  } catch (err) {
    console.error("[courier] AiSensy OTP send error", err);
    return false;
  }
}

export const courierRiderAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        order_id: z.string().uuid(),
        to_status: z.enum(["ARRIVED_PICKUP", "IN_TRANSIT"]),
        lat: z.number().optional(),
        lng: z.number().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("courier_rider_advance" as never, {
      _order_id: data.order_id,
      _to_status: data.to_status,
      _lat: data.lat ?? null,
      _lng: data.lng ?? null,
    } as never);
    if (error) rpcError(error.message);

    const out = result as { ok: boolean; otp_issued?: boolean; reason?: string };
    if (!out?.ok || !out.otp_issued) return out;

    // Deliver the freshly issued OTP to the right contact over WhatsApp.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const purpose = data.to_status === "ARRIVED_PICKUP" ? "pickup" : "delivery";
    const { data: order } = await supabaseAdmin
      .from("courier_orders")
      .select("pickup_contact_phone, drop_contact_phone")
      .eq("id", data.order_id)
      .maybeSingle();
    const { data: secrets } = await supabaseAdmin
      .from("courier_order_secrets")
      .select("pickup_otp_issued_at, delivery_otp_issued_at")
      .eq("order_id", data.order_id)
      .maybeSingle();
    const issuedAt =
      purpose === "pickup" ? secrets?.pickup_otp_issued_at : secrets?.delivery_otp_issued_at;
    if (!order || !issuedAt) return out;

    const { data: otp } = await supabaseAdmin.rpc("courier_derive_otp" as never, {
      _order_id: data.order_id,
      _purpose: purpose,
      _issued_at: issuedAt,
    } as never);
    if (typeof otp === "string") {
      const phone =
        purpose === "pickup" ? order.pickup_contact_phone : order.drop_contact_phone;
      await sendCourierOtp(phone, otp);
    }
    return out;
  });

// Return charge (failed drop): customer pays the per-km return fee.
// The amount always comes from the database, never from the client.
export const createReturnChargePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ charge_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const keyId = process.env["RAZORPAY_KEY_ID"];
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keyId || !keySecret) throw new Error("Payments are not configured");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: charge } = await supabaseAdmin
      .from("courier_order_charges" as never)
      .select("id, order_id, status, total_amount")
      .eq("id", data.charge_id)
      .maybeSingle();
    const c = charge as { id: string; order_id: string; status: string; total_amount: number } | null;
    if (!c) throw new Error("Charge not found");
    const { data: order } = await supabaseAdmin
      .from("courier_orders")
      .select("id, customer_id")
      .eq("id", c.order_id)
      .maybeSingle();
    if (!order || order.customer_id !== context.userId) throw new Error("Forbidden");
    if (c.status !== "pending") throw new Error("This charge is not payable");

    const amountPaise = Math.round(Number(c.total_amount) * 100);
    if (amountPaise <= 0) throw new Error("This charge is not payable");

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const rzRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: `cret_${c.id}`.slice(0, 40),
        notes: { purpose: "courier_return", courier_order_id: c.order_id, charge_id: c.id },
      }),
    });
    if (!rzRes.ok) {
      console.error("[courier] return charge razorpay order failed", await rzRes.text());
      throw new Error("Could not start the payment. Please try again.");
    }
    const rzOrder = (await rzRes.json()) as { id: string };
    await supabaseAdmin
      .from("courier_order_charges" as never)
      .update({ razorpay_order_id: rzOrder.id } as never)
      .eq("id", c.id);

    return { charge_id: c.id, razorpay_order_id: rzOrder.id, amount: amountPaise, key_id: keyId };
  });

// ---- OTP access for the order owner and for stop contacts (matched by phone) ----
type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
const stopIdSchema = z.object({ stop_id: z.string().uuid() });

export const courierGetOrderOtps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ order_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: out, error } = await context.supabase.rpc("courier_get_order_otps" as never, {
      _order_id: data.order_id,
    } as never);
    if (error) rpcError(error.message);
    return out as unknown as Array<Record<string, Json>>;
  });

export const courierMyContactDeliveries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: out, error } = await context.supabase.rpc("courier_my_contact_deliveries" as never);
    if (error) rpcError(error.message);
    return out as unknown as Array<Record<string, Json>>;
  });

export const courierGetContactView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => stopIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: out, error } = await context.supabase.rpc("courier_get_contact_view" as never, {
      _stop_id: data.stop_id,
    } as never);
    if (error) rpcError(error.message);
    return out as unknown as Record<string, Json>;
  });

export const courierGetRiderLocationForStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => stopIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: out, error } = await context.supabase.rpc(
      "courier_get_rider_location_for_stop" as never,
      { _stop_id: data.stop_id } as never,
    );
    if (error) rpcError(error.message);
    return out as unknown as Record<string, Json>;
  });

/** Regular-segment stop limits and extra-stop fees for a city + vehicle. */
export const courierGetRateLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ city: z.string().min(1).max(60), vehicle_type_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("courier_vehicle_rates" as never)
      .select("city, extra_pickup_fee, extra_drop_fee, max_pickups, max_drops")
      .eq("vehicle_type_id", data.vehicle_type_id)
      .eq("customer_segment", "regular");
    const list = (rows ?? []) as unknown as Array<{
      city: string;
      extra_pickup_fee: number | null;
      extra_drop_fee: number | null;
      max_pickups: number | null;
      max_drops: number | null;
    }>;
    const row = list.find((r) => r.city.trim().toLowerCase() === data.city.trim().toLowerCase());
    return {
      extra_pickup_fee: Number(row?.extra_pickup_fee ?? 0),
      extra_drop_fee: Number(row?.extra_drop_fee ?? 0),
      max_pickups: row ? (row.max_pickups == null ? 20 : Number(row.max_pickups)) : 1,
      max_drops: row ? (row.max_drops == null ? 20 : Number(row.max_drops)) : 1,
    };
  });

/** Change one stop's contact (same edit limits as today, enforced in the database). */
export const courierUpdateStopContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        stop_id: z.string().uuid(),
        name: z.string().min(1).max(80),
        phone: z.string().min(10).max(15),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: out, error } = await context.supabase.rpc("courier_update_stop_contact" as never, {
      _stop_id: data.stop_id,
      _name: data.name,
      _phone: data.phone,
    } as never);
    if (error) rpcError(error.message);
    return out as unknown as Record<string, Json>;
  });
