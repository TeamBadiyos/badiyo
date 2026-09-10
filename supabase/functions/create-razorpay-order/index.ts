// Supabase Edge Function: create-razorpay-order
// Computes the authoritative amount SERVER-SIDE from the catalogue.
// Preferred input: { item_id } -> service_price_options.customer_price.
// Legacy fallback: { service_duration_minutes } -> service_catalogue_config.
// NEVER trusts a client-supplied amount.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupaClient = ReturnType<typeof createClient>;

/** True when an availability_overrides row currently blocks this target. */
async function isBlocked(
  supabase: SupaClient,
  targetType: "item" | "category",
  targetId: string | null,
): Promise<boolean> {
  if (!targetId) return false;
  const { data, error } = await supabase
    .from("availability_overrides")
    .select("is_unavailable, unavailable_from, unavailable_until")
    .eq("target_type", targetType)
    .eq("target_id", targetId);
  if (error) {
    console.error("availability lookup failed", error);
    return false;
  }
  const now = Date.now();
  return (data ?? []).some((row: Record<string, unknown>) => {
    if (!row.is_unavailable) return false;
    const from = row.unavailable_from ? Date.parse(String(row.unavailable_from)) : null;
    const until = row.unavailable_until ? Date.parse(String(row.unavailable_until)) : null;
    if (from !== null && Number.isFinite(from) && now < from) return false;
    if (until !== null && Number.isFinite(until) && now > until) return false;
    return true;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      return json({ error: "Razorpay keys are not configured" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const itemId = typeof body?.item_id === "string" ? body.item_id.trim() : "";
    const durationMinutes = Number(body?.service_duration_minutes);
    const currency = typeof body?.currency === "string" ? body.currency : "INR";
    const receipt = typeof body?.receipt === "string" ? body.receipt : `rcpt_${Date.now()}`;
    // "booking" orders must end up as a booking (webhook safety net applies).
    // "extension" orders top up an existing booking and must NOT be recovered.
    const purpose = body?.purpose === "extension" ? "extension" : "booking";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let price: number | null = null;

    if (itemId) {
      // Primary path: works for BOTH duration-based and flat-priced items,
      // because the price is read from the exact item the customer picked.
      const { data: item, error: itemErr } = await supabase
        .from("service_price_options")
        .select("id, customer_price, is_active, service_id, services(id, is_active, category_id)")
        .eq("id", itemId)
        .maybeSingle();

      if (itemErr || !item) {
        return json({ error: "Service not available" }, 400);
      }
      const svc = (item as Record<string, unknown>).services as
        | { is_active?: boolean; category_id?: string | null }
        | null;
      if (!item.is_active || (svc && svc.is_active === false)) {
        return json({ error: "Service not available" }, 400);
      }

      const categoryId = svc?.category_id ?? null;
      if (
        (await isBlocked(supabase, "item", itemId)) ||
        (await isBlocked(supabase, "category", categoryId))
      ) {
        return json({ error: "This service isn't available right now" }, 409);
      }

      price = Number(item.customer_price);
    } else {
      // Legacy fallback for older clients that only send a duration.
      if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
        return json({ error: "item_id is required" }, 400);
      }
      const { data: svc, error: svcErr } = await supabase
        .from("service_catalogue_config")
        .select("price")
        .eq("duration_minutes", durationMinutes)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (svcErr || !svc) {
        return json({ error: "Service not available" }, 400);
      }
      price = Number(svc.price);
    }

    if (!Number.isFinite(price!) || price! <= 0) {
      return json({ error: "Invalid service price" }, 400);
    }

    // GST is configured by admins in ops_settings and charged on top of the price.
    let gstPercent = 5;
    try {
      const { data: gstRow } = await supabase
        .from("ops_settings")
        .select("value")
        .eq("key", "gst_percent")
        .maybeSingle();
      const parsed = Number(String(gstRow?.value ?? "").replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) gstPercent = parsed;
    } catch (gstErr) {
      console.error("gst_percent lookup failed", gstErr);
    }

    const basePaise = Math.round(price! * 100);
    const gstPaise = Math.round((basePaise * gstPercent) / 100);
    const amount = basePaise + gstPaise;
    if (!Number.isInteger(amount) || amount < 100) {
      return json({ error: "Invalid service price" }, 400);
    }

    const auth = btoa(`${keyId}:${keySecret}`);
    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency,
        receipt,
        notes: {
          purpose,
          gst_percent: String(gstPercent),
          base_price: String(price),
        },
      }),
    });

    const text = await rzpRes.text();
    if (!rzpRes.ok) {
      console.error("Razorpay order create failed", rzpRes.status, text);
      return json({ error: "Failed to create Razorpay order", details: text }, 502);
    }

    const order = JSON.parse(text);

    // Persist a payment intent so a paid order can be recovered server-side
    // (by the Razorpay webhook) even if the client never saves the booking.
    try {
      const draft = body?.booking_draft;
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      let userId: string | null = null;
      if (token) {
        const { data: userRes } = await supabase.auth.getUser(token);
        userId = userRes?.user?.id ?? null;
      }
      if (draft && userId) {
        const { error: intentErr } = await supabase.from("payment_intents").insert({
          user_id: userId,
          razorpay_order_id: order.id,
          amount: order.amount,
          currency: order.currency,
          payload: {
            address_id: draft.address_id ?? null,
            service_duration_minutes: draft.service_duration_minutes ?? 0,
            service_label: draft.service_label ?? "Service",
            slot_type: draft.slot_type ?? "now",
            scheduled_date: draft.scheduled_date ?? null,
            scheduled_time_slot: draft.scheduled_time_slot ?? null,
            booking_lat: draft.booking_lat ?? null,
            booking_lng: draft.booking_lng ?? null,
            item_id: itemId || null,
          },
        });
        if (intentErr) console.error("payment_intents insert failed", intentErr);
      }
    } catch (intentErr) {
      console.error("payment intent capture failed", intentErr);
    }

    return json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: keyId,
    });
  } catch (err) {
    console.error("create-razorpay-order error", err);
    return json({ error: (err as Error).message || "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
