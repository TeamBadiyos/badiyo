# Courier (Porter-type) — backend foundation

Latur, intra-city, single pickup + single drop. Abhi sirf bike/moped, lekin sab config data-driven — naya vehicle sirf ek row add karke chalu ho jayega. Is round me koi UI nahi, sirf database + server logic.

## Kya reuse ho raha hai (naya duplicate nahi)

- **City**: existing text city (`zones.city = 'Latur'`, `dispatch_config.city`). Koi nayi cities table nahi.
- **Riders**: existing `experts` (online flag, live location, KYC, approval, wallet). Courier skill = `partner_skills` ka ek service category.
- **Dispatch**: existing `haversine_km`, `dispatch_config` (radius, expand step, timeout) — courier ke liye wahi config padhi jayegi.
- **Payment**: prepaid, existing Razorpay flow — `payment_intents` + `/api/public/webhooks/razorpay`, purpose tag `courier`.
- **Coupon / wallet**: existing `coupon_quote`, `coupon_redemptions`, `wallet_ledger`.
- **GST**: existing `get_gst_percent()`.
- **Notifications**: existing `notify_push_event` / customer + expert push functions.
- **Audit**: existing `audit_logs`.
- **Roles**: existing `staff_users` + `is_active_staff(uid, roles[])`.

## Nayi tables

1. **service_flags** — `service_key`, `city`, `is_active`, `label`, `sort_order`. Off hone par service app ke response se hat jayegi aur order create reject hoga.
2. **courier_vehicle_types** — name, icon, is_active, sort_order, max_weight_kg, inclusions[], exclusions[], required_skill (service_category_id), required_documents[].
3. **courier_vehicle_rates** — (city, vehicle_type_id) unique: base_fare, included_km, per_km, min_fare, free_wait_min, wait_per_min, platform_fee, commission_pct.
4. **courier_types** — Document, Food, Grocery, Medicine, Other: name, icon, is_active, sort_order, extra_fee, instructions. Mapping: **courier_vehicle_courier_types** (kaunsa parcel type kaunse vehicle par allowed).
5. **courier_orders** — customer, city, vehicle_type, courier_type, pickup/drop (lat, lng, address, contact_name, contact_phone), package_description, weight_kg, prohibited_items_confirmed, distance_km, fare_breakdown (jsonb), quote_expires_at, subtotal/discount/gst/total, coupon + wallet fields, payment fields (razorpay ids, payment_status), status, rider (expert_id), pickup_otp_hash, delivery_otp_hash, otp_attempts, otp_expires_at, cancel_reason_code, proof_photo_url, arrived_pickup_at / picked_up_at / delivered_at / waiting_minutes / waiting_charge, timestamps.
6. **courier_order_events** — har status change: order_id, from_status, to_status, actor_type, actor_id, meta jsonb, created_at (trigger se auto).
7. **courier_offers** — order_id, expert_id, sent_at, expires_at, status (pending/accepted/rejected/expired), distance_km.

Sab tables par GRANT + RLS + updated_at trigger.

## Status flow

`REQUESTED → SEARCHING → DRIVER_ASSIGNED → ARRIVED_PICKUP → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED`, plus `CANCELLED` aur `FAILED_DELIVERY`.

- Allowed transitions ek server-side function me enforce honge; galat jump reject.
- `PICKED_UP` ke baad rider cancel nahi kar sakta — sirf incident (`FAILED_DELIVERY` with reason code).
- Har transition par event row + notification emit.

## Fare (sirf server par)

```text
base    = max(min_fare, base_fare + max(0, km - included_km) * per_km)
waiting = max(0, waiting_minutes - free_wait_min) * wait_per_min
total   = (base + waiting + courier_type.extra_fee + platform_fee - discount) + GST
```

- Distance Google Routes API se (server function, key server-side). API fail ho to haversine * road-factor fallback aur order "quote unavailable" batayega.
- Quote lock: `fare_breakdown` + `quote_expires_at` (10 min). Client ka bheja hua total hamesha ignore, server dobara compute karke compare karta hai.
- Waiting charge rider timestamps se auto: `ARRIVED_PICKUP → PICKED_UP` ka server-side gap, delivery par final total me add.

## OTP

- Pickup OTP: `ARRIVED_PICKUP → PICKED_UP`. Delivery OTP: `IN_TRANSIT → DELIVERED`.
- Sirf hash store (existing OTP hashing pattern), expiry, max 5 attempts, lockout ke baad ops intervention.
- Verify sirf SECURITY DEFINER RPC me; plain OTP customer ko hi dikhta hai.

## Dispatch

- Nearest online + approved + courier-skill-matched + free rider, `haversine_km` se radius ke andar.
- Ek-ek karke offer, 30s timeout (`dispatch_config` se configurable), reject/expire par agla rider, radius expand step bhi wahi config.
- Cron-style sweeper stale offers expire karta hai (existing `expand_stale_broadcasts` jaisa pattern).

## Security

- **Customer**: sirf apne orders read; koi direct write nahi.
- **Rider**: sirf apne offers aur assigned order read; status update sirf RPC se.
- **Config tables** (service_flags, vehicle types, rates, courier types, mapping): write sirf `super_admin`; `ops_manager` read-only; public ko sirf active rows read.
- Sab operational writes SECURITY DEFINER RPC / server function se — `authenticated` ke paas sirf wahi functions.
- Order create reject: service flag city me off, vehicle inactive, courier type us vehicle par allowed nahi, weight limit se zyada, prohibited items confirm nahi, ya quote expire.
- Har config change `audit_logs` me before/after ke saath.

## Notifications

Har status change par existing engine me event: customer ko (rider assigned, pohonch gaya, parcel utha liya, transit, delivered) aur rider ko (naya offer, assign, cancel). Ops ko koi rider na milne par alert (existing dispatch alert pattern).

## Technical details

- Migration 1: config tables + seed (Latur service flag on, bike/moped vehicle, rates, 5 courier types, mapping).
- Migration 2: courier_orders / events / offers + RLS + grants + status-transition trigger + event logging trigger.
- Migration 3: RPCs — `courier_quote`, `courier_create_order`, `courier_cancel_order`, `courier_dispatch_next`, `courier_offer_respond`, `courier_advance_status`, `courier_verify_pickup_otp`, `courier_verify_delivery_otp`, `courier_report_incident`, plus staff config RPCs with audit.
- Server function `src/lib/courier.functions.ts`: Google Routes distance + quote sign-off (secret server-side); Razorpay order create purpose `courier`; webhook `purpose: "courier"` handle karke order confirm + dispatch start.
- Koi Supabase Edge Function nahi — TanStack server functions + Postgres RPC.
- Verification: typecheck, production build, DB linter, aur RPCs ko seeded data par direct SQL se test.

## Out of scope (next round)

Customer UI (vehicle/parcel selection, map, tracking), rider app screens, Command Center config screens, inter-city aur multi-stop.
