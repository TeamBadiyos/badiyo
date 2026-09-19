# Courier (Porter-type) — backend foundation (v4)

Latur, intra-city, single pickup + single drop. Bike/moped, sab config data-driven. Is round me UI nahi — sirf database + server logic.

## Aapke sawalon ke jawab

**Cancellation fee ka default**: abhi system me courier ka koi fee nahi hai — home-service me `customer_cancel_booking_apply` fee client se leta hai aur `ops_settings` me sirf `gst_percent` (5) aur `expert_stale_online_minutes` (1440) hain. Courier ke liye naya server-side key banega: `courier_cancel_fee_arrived`, **default ₹30** (ya base fare ka 50%, jo kam ho — cap ke saath). Ye ops_settings se aayega, client se nahi, aur poora amount rider ko credit hoga.

**Scheduler**: `pg_cron` + `pg_net` installed. `expand_stale_broadcasts()` job `dispatch-radius-expand` (30s) home-service ke liye hai; courier ke liye **alag job** `courier-dispatch-sweeper` (30s, exception-wrapped) banega.

**`is_active_staff` exact signature**:
```sql
is_active_staff(_uid uuid, _roles text[]) RETURNS boolean
-- STABLE SECURITY DEFINER, search_path = public
-- _uid != auth.uid() → false; warna staff_users me status='active' AND role = ANY(_roles)
```
Rider identity: `get_expert_id_for_auth(auth.uid())`; generic: `resolve_caller_identity(auth.uid())`.

**WhatsApp OTP**: existing login wala AiSensy campaign structure (`AISENSY_API_KEY` + courier campaign name env). Pickup OTP pickup contact ko, delivery OTP drop contact ko. Campaign approve hone tak fallback: OTP customer app me.

## Reuse (koi duplicate table nahi)

City = text (`zones.city`), riders = `experts` + `partner_skills`, dispatch tuning = `dispatch_config` + `haversine_km`, payment = `payment_intents` + Razorpay webhook (purpose `courier`), coupons = `coupon_quote`/`coupon_redemptions`, wallet = `wallet_ledger`, GST = `get_gst_percent()`, audit = `audit_logs`, roles = `staff_users`/`is_active_staff`, push = existing notify functions.

## Nayi tables

1. **service_flags** — service_key, city, is_active, label, sort_order. Courier flag **OFF** seed.
2. **courier_vehicle_types** — name, icon, is_active, sort_order, max_weight_kg, inclusions[], exclusions[], required_skill, required_documents[]. Latur bike **is_active=false**.
3. **courier_vehicle_rates** — (city, vehicle_type_id): base_fare, included_km, per_km, min_fare, platform_fee, commission_pct, `is_placeholder default true` — placeholder par order block; flip **sirf super_admin**.
4. **courier_types** (Document/Food/Grocery/Medicine/Other) + mapping **courier_vehicle_courier_types**.
5. **courier_orders** — customer, city, vehicle_type, courier_type, pickup/drop (lat, lng, address, contact_name, contact_phone), package_description, weight_kg, prohibited_items_confirmed, distance_km, fare_breakdown jsonb, quote_expires_at, amounts, coupon + wallet fields, razorpay ids + payment_status, status, rider, otp_attempts, rider_cancel_count, cancel_reason_code, `refund_status` (none/refund_pending/processing/done/failed), refund_amount, refund_id, refund_attempts, proof_photo_url, stage timestamps.
6. **courier_order_secrets** — order_id PK, pickup/delivery otp hash + expiry + attempts. RLS deny-all.
7. **courier_order_events** — status history.
8. **courier_offers** — order_id, expert_id, sent_at, expires_at, status, distance_km.

Sab par GRANT + RLS + updated_at trigger.

## OTP

- HMAC derive: `HMAC(secret, order_id || ':' || purpose || ':' || issued_at)`. Secret **Vault me, migration me randomly generate** (`gen_random_bytes` → `vault.create_secret`), koi literal nahi.
- Sirf hash + expiry store; max 5 attempts, phir lock + ops alert.
- Send: AiSensy — pickup OTP pickup contact ko, delivery OTP drop contact ko.
- `courier_get_otp(order_id, purpose)` — order owner only, stage-gated (pickup: ARRIVED_PICKUP ke baad, delivery: IN_TRANSIT ke baad). Rider kabhi read nahi karta.

## Status flow, cancel/refund matrix

`REQUESTED → SEARCHING → DRIVER_ASSIGNED → ARRIVED_PICKUP → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED`, plus `CANCELLED`, `FAILED_DELIVERY`.

| Stage | Customer cancel | Rider cancel | Paisa |
|---|---|---|---|
| REQUESTED unpaid | Auto-expire 15 min (config) | — | Coupon release, charge nahi |
| SEARCHING | Haan | — | 100% refund + coupon release |
| SEARCHING timeout | Auto-cancel | — | 100% refund + coupon release + notify |
| DRIVER_ASSIGNED | Haan | Haan → wapas SEARCHING | 100% refund |
| ARRIVED_PICKUP | Haan, fee ₹30 (config) | Haan, reason ke saath | Total − fee refund; fee rider ko wallet credit |
| PICKED_UP ke baad | Nahi | Nahi | Sirf incident se |
| FAILED_DELIVERY | — | Rider raise kare | Ops decide full/partial/none (staff RPC, audited); rider ko base fare ka 50% (config) minus commission |
| DELIVERED → COMPLETED | — | — | Refund nahi |

- **DELIVERED → COMPLETED**: delivery OTP verify → DELIVERED; sweeper settlement step ise COMPLETED karta hai. **Earnings credit sirf COMPLETED par**, idempotent (`wallet_ledger` unique reason key).
- Rider-cancel attempts cap (config, default 3) — cross hone par order ops queue me.

## Refund pipeline (naya)

1. Sweeper ya cancel RPC sirf DB me `refund_status = 'refund_pending'` + amount set karta hai — koi HTTP call DB se nahi.
2. Ek server route `/api/public/courier/process-refunds` (shared secret header se authenticated) pending rows uthata hai aur **Razorpay refund idempotently** call karta hai (idempotency key = order id + stage), result wapas likhta hai.
3. Route ko `pg_net` se sweeper trigger karta hai (existing `auto-expire-unassigned-bookings` job jaisa pattern). Fail par `refund_attempts++`, exponential backoff, N attempts ke baad ops alert.
4. **Late payment webhook**: jo order already expire/cancel ho chuka hai uska payment aa jaye to webhook use accept nahi karega — turant `refund_pending` mark karke customer ko notify karega (auto-refund).

## Fare (server-side only)

```text
base  = max(min_fare, base_fare + max(0, km - included_km) * per_km)
total = (base + courier_type.extra_fee + platform_fee - discount) + GST
```
Distance Google Routes API (key server-side), fail par haversine × road-factor. Quote lock 10 min, client ka total ignore, quote par per-user rate limit.

## Dispatch

- Eligible rider: online, approved, courier skill, koi active courier order nahi, koi active home-service booking nahi, aur agla scheduled home-service slot buffer minutes (config) ke andar nahi.
- Nearest-first, 30s offer timeout, expire par agla, radius expand `dispatch_config` se.
- Accept atomic: `FOR UPDATE SKIP LOCKED` + order status guard; ek rider = ek active job.
- Cron `courier-dispatch-sweeper` (30s, exception-wrapped, home-service se isolated): offer expiry, radius expand, SEARCHING timeout cancel, unpaid REQUESTED expiry, refund_pending trigger, DELIVERED→COMPLETED settlement.
- `ARRIVED_PICKUP` par geofence (config meters).

## Security

- Customer sirf apne orders; rider sirf apne offers + assigned order; pickup/drop contact number rider ko **sirf assign hone ke baad apne order par**, warna masked.
- Secrets table dono ke liye deny.
- Config tables: write sirf `super_admin`, `ops_manager` read-only, public sirf active rows.
- Har RPC: `SECURITY DEFINER`, `SET search_path = public`, andar caller role check, `REVOKE EXECUTE FROM PUBLIC, anon`.
- **Sweeper/internal functions**: EXECUTE sirf `service_role`/`postgres`; `authenticated` aur `anon` dono se revoke.
- Create reject: flag off, vehicle inactive, rate placeholder, courier type allowed nahi, weight paar, prohibited confirm nahi, quote expire.
- Har config/staff action audit_logs me before/after.

## Staff RPCs (backend abhi)

force reassign, force cancel, refund, resolve incident, set service flag, vehicle/rate/courier-type CRUD — role-checked + audited.

## Notifications

Har status change par existing engine: customer (rider mila, pohoncha, picked, transit, delivered, cancel/refund) aur rider (offer, assign, cancel, earning credit). Rider na mile to ops alert.

## Migrations

1. Config tables + seed (courier OFF, bike inactive, placeholder rates, courier types, mapping) + Vault OTP secret (random generated) + `courier_cancel_fee_arrived = 30`.
2. courier_orders / secrets / events / offers + RLS + grants + transition guard + event trigger.
3. RPCs + sweeper + cron job + refund route wiring.
4. **Alag apply**: existing booking create path me service_flag check, **missing flag row = active** (fail-open). Rollback SQL saath me (check hatane ka + poora courier schema drop).

Server side: `src/lib/courier.functions.ts` (Routes distance, Razorpay create purpose `courier`, AiSensy OTP send) + `/api/public/courier/process-refunds` route. Koi nayi Supabase Edge Function nahi.

## Verification

Typecheck, production build, DB linter, aur RLS/RPC tests role simulate karke:
- anon se har RPC deny
- customer: doosre ka order read deny, secrets table deny, config write deny
- rider: bina assign contact number masked, doosre ka offer accept deny
- ops_manager: config write deny (read allowed); `is_placeholder` flip sirf super_admin
- cross-role RPC deny (customer rider-RPC call kare to fail)
- **race tests**: do rider ek saath accept (sirf ek jeete), aur cancel-vs-accept race (consistent final state)

## Out of scope

Waiting charges, sab UI (customer/rider/Command Center), inter-city, multi-stop.
