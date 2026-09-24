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
    // "tip" orders pay the expert directly and must NOT be recovered either.
    // "store_order" pays for a shop order whose amount is already in the DB.
    const KNOWN_PURPOSES = ["extension", "tip", "store_order", "courier"] as const;
    const purpose = KNOWN_PURPOSES.includes(body?.purpose)
      ? (body.purpose as string)
      : "booking";


    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Service status/hours guard: block NEW booking/courier payments when the
    // service is closed (status, holiday, outside hours, last-order buffer).
    // Extension and tip payments for running orders are never blocked.
    // Fail-open: if the check itself errors, payment proceeds.
    if (purpose === "booking" || purpose === "courier") {
      const serviceKey = purpose === "courier" ? "courier" : "clean";
      const draftForSlot = body?.booking_draft;
      const isScheduled =
        purpose === "booking" &&
        draftForSlot?.slot_type === "scheduled" &&
        typeof draftForSlot?.scheduled_date === "string" &&
        typeof draftForSlot?.scheduled_time_slot === "string";

      let blocked = false;
      if (isScheduled) {
        // Advance bookings are judged against the chosen slot, not "right now".
        const { data: slotOk, error: slotErr } = await supabase.rpc("service_slot_allowed", {
          _service_key: serviceKey,
          _date: draftForSlot.scheduled_date,
          _slot: draftForSlot.scheduled_time_slot,
          _duration_minutes: Number.isInteger(durationMinutes) ? durationMinutes : 60,
        });
        blocked = !slotErr && slotOk?.ok === false;
      } else {
        const { data: canOrder, error: err } = await supabase.rpc("service_can_order", {
          _service_key: serviceKey,
        });
        blocked = !err && canOrder === false;
      }

      if (blocked) {
        const { data: st } = await supabase.rpc("service_effective_state", {
          _service_key: serviceKey,
        });
        return json(
          {
            error: "SERVICE_CLOSED",
            reason_code: st?.reason_code ?? "closed",
            next_open_at: st?.next_open_at ?? null,
            message_en: st?.message_en ?? null,
            message_mr: st?.message_mr ?? null,
          },
          409,
        );
      }
    }

    // Store orders: the amount is the one the database already computed for
    // this order row. Nothing from the client is trusted.
    if (purpose === "store_order") {
      const storeOrderId =
        typeof body?.store_order_id === "string" ? body.store_order_id.trim() : "";
      if (!storeOrderId) return json({ error: "store_order_id is required" }, 400);

      const storeToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: storeUserRes } = storeToken
        ? await supabase.auth.getUser(storeToken)
        : { data: null };
      const storeUserId = storeUserRes?.user?.id ?? null;
      if (!storeUserId) return json({ error: "Not signed in" }, 401);

      const { data: order, error: orderErr } = await supabase
        .from("merchant_orders")
        .select("id, user_id, total_amount, payment_status, status, order_number")
        .eq("id", storeOrderId)
        .maybeSingle();
      if (orderErr || !order || order.user_id !== storeUserId) {
        return json({ error: "Order not found" }, 404);
      }
      if (order.payment_status === "paid") {
        return json({ error: "Order is already paid" }, 409);
      }
      const storeAmount = Math.round(Number(order.total_amount) * 100);
      if (!Number.isInteger(storeAmount) || storeAmount <= 0) {
        return json({ error: "Invalid order amount" }, 400);
      }

      const storeAuth = btoa(`${keyId}:${keySecret}`);
      const storeRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${storeAuth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: storeAmount,
          currency,
          receipt: String(order.order_number ?? receipt).slice(0, 40),
          notes: { purpose: "store_order", store_order_id: storeOrderId },
        }),
      });
      const storeText = await storeRes.text();
      if (!storeRes.ok) {
        console.error("Razorpay store order failed", storeRes.status, storeText);
        return json({ error: "Failed to create Razorpay order", details: storeText }, 502);
      }
      const storeOrder = JSON.parse(storeText);
      return json({
        order_id: storeOrder.id,
        amount: storeOrder.amount,
        currency: storeOrder.currency,
        key_id: keyId,
      });
    }

    // Tips: fixed server-side whitelist, no GST, no catalogue lookup.
    if (purpose === "tip") {
      const ALLOWED_TIPS = [25, 50, 100];
      const tipAmount = Number(body?.tip_amount);
      if (!ALLOWED_TIPS.includes(tipAmount)) {
        return json({ error: "Invalid tip amount" }, 400);
      }
      const auth = btoa(`${keyId}:${keySecret}`);
      const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: tipAmount * 100,
          currency,
          receipt,
          notes: { purpose: "tip", tip_amount: String(tipAmount) },
        }),
      });
      const tipText = await rzpRes.text();
      if (!rzpRes.ok) {
        console.error("Razorpay tip order failed", rzpRes.status, tipText);
        return json({ error: "Failed to create Razorpay order", details: tipText }, 502);
      }
      const tipOrder = JSON.parse(tipText);
      return json({
        order_id: tipOrder.id,
        amount: tipOrder.amount,
        currency: tipOrder.currency,
        key_id: keyId,
      });
    }

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

    // Who is paying (needed for coupons and for the payment-intent safety net).
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    if (token) {
      const { data: userRes } = await supabase.auth.getUser(token);
      userId = userRes?.user?.id ?? null;
    }

    // Coupon: the discount is always computed server-side from the coupon rules.
    const couponCode =
      typeof body?.coupon_code === "string" && body.coupon_code.trim()
        ? body.coupon_code.trim().toUpperCase()
        : null;
    let discount = 0;
    if (couponCode && userId && purpose === "booking") {
      const { data: quote, error: quoteErr } = await supabase.rpc("coupon_quote", {
        _user_id: userId,
        _code: couponCode,
        _base_amount: price!,
        _duration_minutes: Number.isInteger(durationMinutes) ? durationMinutes : null,
      });
      if (quoteErr) {
        console.error("coupon_quote failed", quoteErr);
      } else if (quote && (quote as Record<string, unknown>).ok === true) {
        discount = Number((quote as Record<string, unknown>).discount ?? 0);
      }
    }

    // GST applies to the taxable value left AFTER the discount, and the
    // payable amount is rounded to the nearest whole rupee.
    const basePaise = Math.round(price! * 100);
    const discountPaise = Math.min(
      Math.max(Math.round(discount * 100), 0),
      basePaise,
    );
    const taxablePaise = basePaise - discountPaise;
    const gstPaise = Math.round((taxablePaise * gstPercent) / 100);
    const amount = Math.round((taxablePaise + gstPaise) / 100) * 100;
    if (!Number.isInteger(amount) || amount < 0) {
      return json({ error: "Invalid service price" }, 400);
    }

    // Fully discounted bill: no gateway payment at all.
    if (amount === 0) {
      const freeOrderId = `free_${crypto.randomUUID()}`;
      if (discountPaise > 0 && couponCode && userId) {
        const { error: reserveErr } = await supabase.rpc("system_coupon_reserve", {
          _user_id: userId,
          _code: couponCode,
          _order_id: freeOrderId,
          _base_amount: price!,
          _duration_minutes: Number.isInteger(durationMinutes) ? durationMinutes : 0,
        });
        if (reserveErr) {
          console.error("system_coupon_reserve failed", reserveErr);
          return json({ error: "Coupon could not be applied" }, 400);
        }
      }
      return json({
        free: true,
        order_id: freeOrderId,
        amount: 0,
        currency,
        key_id: keyId,
      });
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
          ...(discountPaise > 0 && couponCode
            ? { coupon_code: couponCode, discount: String(discountPaise / 100) }
            : {}),
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

    // Hold the coupon against this order so the booking trigger can apply it once.
    if (discountPaise > 0 && couponCode && userId) {
      const { error: reserveErr } = await supabase.rpc("system_coupon_reserve", {
        _user_id: userId,
        _code: couponCode,
        _order_id: order.id,
        _base_amount: price!,
        _duration_minutes: Number.isInteger(durationMinutes) ? durationMinutes : 0,
      });
      if (reserveErr) console.error("system_coupon_reserve failed", reserveErr);
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
