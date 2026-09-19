# Courier (Porter-type) — backend foundation (v2)

Latur, intra-city, single pickup + single drop. Abhi sirf bike/moped, lekin sab config data-driven. Is round me koi UI nahi — sirf database + server logic.

## Aapke sawal ka jawab: scheduler

`pg_cron` aur `pg_net` dono installed hain aur 7 jobs already chal rahe hain. `expand_stale_broadcasts()` ko cron job `dispatch-radius-expand` har 30 second par chalata hai. Courier sweeper alag job nahi banega — wahi 30-second job extend karke courier offers ka timeout + radius expand + SEARCHING auto-cancel handle karega, taaki nayi recurring cost na aaye.

## Kya reuse ho raha hai (koi duplicate table nahi)

- **City**: existing text city (`zones.city = 'Latur'`, `dispatch_config.city`).
- **Riders**: existing `experts` + `partner_skills` (courier skill = ek service category).
- **Dispatch config**: `dispatch_config` (radius, expand step, timeout) aur `haversine_km`.
- **Payment**: prepaid — `payment_intents` + `/api/public/webhooks/razorpay`, purpose tag `courier`.
- **Coupon / wallet**: `coupon_quote`, `coupon_redemptions`, `wallet_ledger`.
- **GST**: `get_gst_percent()`. **Audit**: `audit_logs`. **Roles**: `staff_users` + `is_active_staff()`.
- **Notifications**: existing push/notify functions.

## Nayi tables

1. **service_flags** — `service_key`, `city`, `is_active`, `label`, `sort_order`. Seed me courier ke saath existing services bhi (maid, cleaning, delivery, merchant/store, jo bhi segments me hain). Existing booking create path me bhi flag check lagega — off service par booking reject.
2. **courier_vehicle_types** — name, icon, is_active, sort_order, max_weight_kg, inclusions[], exclusions[], required_skill (service_category_id), required_documents[].
3. **courier_vehicle_rates** — (city, vehicle_type_id) unique: base_fare, included_km, per_km, min_fare, platform_fee, commission_pct. (Waiting-charge fields is round me nahi.)
4. **courier_types** — Document, Food, Grocery, Medicine, Other: name, icon, is_active, sort_order, extra_fee, instructions. Mapping table **courier_vehicle_courier_types**.
5. **courier_orders** — customer, city, vehicle_type, courier_type, pickup/drop (lat, lng, address, contact_name, contact_phone), package_description, weight_kg, prohibited_items_confirmed, distance_km, fare_breakdown jsonb, quote_expires_at, subtotal/discount/gst/total, coupon + wallet fields, razorpay ids + payment_status, status, rider (expert_id), otp_attempts, cancel_reason_code, refund fields, proof_photo_url, stage timestamps.
6. **courier_order_secrets** — order_id (PK), pickup_otp_hash, delivery_otp_hash, pickup_expires_at, delivery_expires_at, attempts. **Customer aur rider dono ke liye zero read access** — RLS deny-all, sirf SECURITY DEFINER functions padhte hain.
7. **courier_order_events** — har status change ka history (from, to, actor_type, actor_id, meta).
8. **courier_offers** — order_id, expert_id, sent_at, expires_at, status, distance_km.

Sab par GRANT + RLS + updated_at trigger.

## Status flow aur cancel/refund matrix

`REQUESTED → SEARCHING → DRIVER_ASSIGNED → ARRIVED_PICKUP → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED`, plus `CANCELLED` aur `FAILED_DELIVERY`.

| Stage | Customer cancel | Rider cancel | Refund |
|---|---|---|---|
| REQUESTED / SEARCHING | Haan | — | 100% refund + coupon release |
| SEARCHING timeout (dispatch exhausted) | Auto-cancel | — | 100% refund + coupon release, dono ko notify |
| DRIVER_ASSIGNED | Haan | Haan (order wapas SEARCHING) | 100% refund |
| ARRIVED_PICKUP | Haan, cancellation fee lag sakti hai (config) | Haan, reason ke saath | Total − fee |
| PICKED_UP ke baad | **Nahi** | **Nahi** | Sirf incident se |
| FAILED_DELIVERY (incident) | — | Rider raise karega | Ops decide kare: full / partial / no refund, staff RPC se, audit ke saath |
| DELIVERED → COMPLETED | — | — | Refund nahi |

FAILED_DELIVERY reason codes: consignee unreachable, address galat, consignee refused, parcel damaged, accident/other. Order `FAILED_DELIVERY` par rukta hai aur ops resolution ka wait karta hai (return-to-sender ya close).

## Fare (sirf server par)

```text
base  = max(min_fare, base_fare + max(0, km - included_km) * per_km)
total = (base + courier_type.extra_fee + platform_fee - discount) + GST
```

- Distance Google Routes API se (key server-side); fail par haversine × road-factor fallback.
- Quote lock: `fare_breakdown` + `quote_expires_at` (10 min). Client ka bheja total hamesha ignore.
- **Quote rate limit**: per user per minute cap (config se), limit paar hone par error.

## OTP

- Pickup OTP: `ARRIVED_PICKUP → PICKED_UP`. Delivery OTP: `IN_TRANSIT → DELIVERED`.
- Value HMAC se derive: `HMAC(secret, order_id || ':' || purpose || ':' || issued_at)` ke digits — plain kahin store nahi, sirf hash `courier_order_secrets` me.
- Expiry, max 5 attempts, uske baad lock + ops alert.
- Verify sirf SECURITY DEFINER RPC me, rider app kabhi OTP read nahi karta.
- **Delivery**: pickup OTP pickup contact ko, delivery OTP drop contact ko WhatsApp/SMS. Abhi sirf hook — `courier_send_otp_message(order_id, purpose)` server function jo provider call ke liye taiyar hai; template baad me plug hoga. Fail hone par ops ko alert.

## Dispatch

- Eligible rider: online, approved, courier skill, **na koi active courier order na koi active home-service booking** (dono tables check).
- Nearest-first offers, 30s timeout (`dispatch_config`), expire par agla rider, radius expand wahi config se.
- **Accept atomic**: offer row `SELECT ... FOR UPDATE SKIP LOCKED` + order status guard, taaki do rider ek order na le. Ek rider par ek hi active job ka constraint.
- 30-second cron sweeper (existing `dispatch-radius-expand` job extend) — offer expiry, radius expand, aur SEARCHING timeout par auto-cancel + refund.
- **Geofence**: `ARRIVED_PICKUP` tabhi allowed jab rider ki live location pickup point ke X meters (config) ke andar ho.

## Earnings

`COMPLETED` par rider ko `wallet_ledger` me credit: `base + extra_fee − commission_pct%` (platform fee aur GST platform ke paas). Idempotent — dobara credit nahi.

## Security

- Customer sirf apne orders, rider sirf apne offers + assigned order. Secrets table dono ke liye deny.
- Config tables: write sirf `super_admin`, `ops_manager` read-only, public ko sirf active rows.
- **Har RPC**: caller role check andar, `SECURITY DEFINER` + `SET search_path = public`, `REVOKE EXECUTE FROM PUBLIC, anon`, grant sirf zaroori role ko.
- Create order reject: service flag off, vehicle inactive, courier type allowed nahi, weight limit paar, prohibited items confirm nahi, quote expire.
- Har config change aur staff action `audit_logs` me before/after ke saath.

## Staff RPCs (backend abhi, UI baad me)

`staff_courier_reassign_rider`, `staff_courier_force_cancel`, `staff_courier_refund`, `staff_courier_resolve_incident`, `staff_courier_set_service_flag`, plus vehicle/rate/courier-type CRUD — sab role-checked aur audited.

## Notifications

Har status change par existing engine me event: customer ko (rider mila, pohoncha, parcel utha, transit, delivered, cancel/refund) aur rider ko (naya offer, assign, cancel, earning credit). Rider na milne par ops alert.

## Technical details

- Migration 1: config tables + seed (service_flags me courier + existing services, Latur bike/moped vehicle + rates, 5 courier types, mapping).
- Migration 2: courier_orders / secrets / events / offers + RLS + grants + transition guard trigger + event logging trigger.
- Migration 3: RPCs — quote, create, cancel, dispatch_next, offer_respond, advance_status, verify_pickup_otp, verify_delivery_otp, report_incident, staff set, plus sweeper function; cron job 1 ka command update.
- Migration 4: existing booking create path me service_flag check.
- Server functions (`src/lib/courier.functions.ts`): Google Routes distance, Razorpay order create purpose `courier`, webhook `courier` handling, OTP send hook.
- Koi Supabase Edge Function nahi — TanStack server functions + Postgres RPC.
- **Verification**: typecheck, production build, DB linter, aur RLS tests sirf admin SQL se nahi — `set local role authenticated` + JWT claim simulate karke customer aur rider dono ke perspective se read/write attempts test honge (cross-user read deny, secrets table deny, config write deny).

## Out of scope

Waiting charges (baad me), customer/rider/Command Center UI, inter-city, multi-stop.
