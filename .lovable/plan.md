# Courier (Porter-type) — backend foundation (v3)

Latur, intra-city, single pickup + single drop. Bike/moped, sab config data-driven. Is round me UI nahi — sirf database + server logic.

## Aapke sawalon ke jawab

**Scheduler**: `pg_cron` + `pg_net` dono installed. `expand_stale_broadcasts()` ko job `dispatch-radius-expand` har 30 second chalata hai. Courier ke liye **alag cron job** banega (`courier-dispatch-sweeper`, 30s) taaki home-service dispatch bilkul isolate rahe; uske andar bhi exception block hoga.

**`is_active_staff` exact signature**:
```sql
is_active_staff(_uid uuid, _roles text[]) RETURNS boolean
-- STABLE SECURITY DEFINER, search_path = public
-- _uid != auth.uid() ho to false; warna staff_users me status='active' aur role = ANY(_roles)
```
Rider identity ke liye `get_expert_id_for_auth(auth.uid())`, generic caller ke liye `resolve_caller_identity(auth.uid())` (returns user_type, user_id) — dono already caller-scoped hain.

**WhatsApp OTP**: existing login wala hi structure — AiSensy campaign API (`AISENSY_API_KEY`, campaign name env se), jaise `send-otp` karta hai. Courier ke liye alag campaign name env var, pickup OTP pickup contact ko, delivery OTP drop contact ko. Jab tak courier campaign approve nahi hota, fallback: OTP customer app me dikhega.

## Reuse (koi duplicate table nahi)

City = text (`zones.city`), riders = `experts` + `partner_skills`, dispatch tuning = `dispatch_config` + `haversine_km`, payment = `payment_intents` + Razorpay webhook (purpose `courier`), coupons = `coupon_quote`/`coupon_redemptions`, wallet = `wallet_ledger`, GST = `get_gst_percent()`, audit = `audit_logs`, roles = `staff_users`/`is_active_staff`, push = existing notify functions.

## Nayi tables

1. **service_flags** — service_key, city, is_active, label, sort_order. **Courier flag OFF seed** hoga.
2. **courier_vehicle_types** — name, icon, is_active, sort_order, max_weight_kg, inclusions[], exclusions[], required_skill, required_documents[]. Latur bike **is_active = false** seed.
3. **courier_vehicle_rates** — (city, vehicle_type_id): base_fare, included_km, per_km, min_fare, platform_fee, commission_pct, `is_placeholder boolean default true` — placeholder rate par order create block, ops confirm karke hi live.
4. **courier_types** — Document, Food, Grocery, Medicine, Other + mapping **courier_vehicle_courier_types**.
5. **courier_orders** — customer, city, vehicle_type, courier_type, pickup/drop (lat, lng, address, contact_name, contact_phone), package_description, weight_kg, prohibited_items_confirmed, distance_km, fare_breakdown jsonb, quote_expires_at, amounts, coupon + wallet fields, razorpay ids + payment_status, status, rider, otp_attempts, rider_cancel_count, cancel_reason_code, refund fields, proof_photo_url, stage timestamps.
6. **courier_order_secrets** — order_id PK, pickup/delivery otp hash + expiry + attempts. RLS deny-all; sirf definer functions padhte hain.
7. **courier_order_events** — status history.
8. **courier_offers** — order_id, expert_id, sent_at, expires_at, status, distance_km.

Sab par GRANT + RLS + updated_at trigger.

## OTP

- HMAC se derive: `HMAC(secret, order_id || ':' || purpose || ':' || issued_at)` ke digits. **Secret Supabase Vault me** (`vault.create_secret`), migration me plaintext nahi; functions `vault.decrypted_secrets` se padhenge.
- Sirf hash + expiry `courier_order_secrets` me, plain kahin store nahi. Max 5 attempts, phir lock + ops alert.
- **Send**: AiSensy campaign se — pickup OTP pickup contact ko, delivery OTP drop contact ko.
- **Customer-visible RPC** `courier_get_otp(order_id, purpose)` — stage-gated: pickup OTP sirf `ARRIVED_PICKUP` ke baad, delivery OTP sirf `IN_TRANSIT` ke baad, aur sirf order ke owner ko. Ye WhatsApp fallback bhi hai.
- Rider kabhi OTP read nahi karta; verify sirf definer RPC me.

## Status flow, cancel/refund matrix

`REQUESTED → SEARCHING → DRIVER_ASSIGNED → ARRIVED_PICKUP → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED`, plus `CANCELLED`, `FAILED_DELIVERY`.

| Stage | Customer cancel | Rider cancel | Paisa |
|---|---|---|---|
| REQUESTED unpaid | Auto-expire (15 min, config) | — | Coupon release, koi charge nahi |
| SEARCHING | Haan | — | 100% refund + coupon release |
| SEARCHING timeout | Auto-cancel | — | 100% refund + coupon release + notify |
| DRIVER_ASSIGNED | Haan | Haan → wapas SEARCHING | 100% refund |
| ARRIVED_PICKUP | Haan, cancellation fee | Haan, reason ke saath | Total − fee refund; **fee rider ko wallet_ledger me credit** |
| PICKED_UP ke baad | Nahi | Nahi | Sirf incident se |
| FAILED_DELIVERY | — | Rider raise kare | Ops decide: full/partial/none (staff RPC, audited). Rider payout: pickup ho chuka hai to base fare ka config% (default 50%) minus commission credit |
| DELIVERED → COMPLETED | — | — | Refund nahi |

- **DELIVERED → COMPLETED**: delivery OTP verify hote hi order DELIVERED; COMPLETED tab jab (a) proof/OTP dono set ho aur (b) settlement run ho — sweeper DELIVERED orders ko turant (ya config delay ke baad) COMPLETED karta hai. **Earnings credit sirf COMPLETED par**, idempotent (`wallet_ledger` unique reason key).
- **Rider-cancel attempts cap**: ek order par rider cancels ki max limit (config, default 3); cap cross hone par order ops queue me jata hai, endlessly SEARCHING nahi ghoomta.
- **Refunds Razorpay API se**, idempotent — refund key = order id + stage, `refund_id` store, dobara call safe.

## Fare (sirf server par)

```text
base  = max(min_fare, base_fare + max(0, km - included_km) * per_km)
total = (base + courier_type.extra_fee + platform_fee - discount) + GST
```
Distance Google Routes API (key server-side), fail par haversine × road-factor. Quote lock 10 min. Client ka total ignore. Quote par per-user rate limit.

## Dispatch

- Eligible rider: online, approved, courier skill, koi active courier order nahi, koi active home-service booking nahi, **aur agla scheduled home-service slot buffer minutes (config) ke andar nahi**.
- Nearest-first, 30s offer timeout, expire par agla, radius expand `dispatch_config` se.
- Accept atomic: `SELECT ... FOR UPDATE SKIP LOCKED` on offer + order status guard; ek rider = ek active job.
- Alag cron job `courier-dispatch-sweeper` (30s, exception-wrapped): offer expiry, radius expand, SEARCHING timeout cancel+refund, unpaid REQUESTED expiry, DELIVERED→COMPLETED settlement.
- `ARRIVED_PICKUP` par geofence: rider location pickup se X meters (config) ke andar.

## Security

- Customer sirf apne orders; rider sirf apne offers + assigned order — **pickup/drop contact number sirf assigned order par, assign hone ke baad** (column-level view/RPC se, warna masked).
- Secrets table dono ke liye deny.
- Config tables: write sirf `super_admin`, `ops_manager` read-only, public sirf active rows.
- Har RPC: `SECURITY DEFINER`, `SET search_path = public`, andar caller role check, `REVOKE EXECUTE FROM PUBLIC, anon`.
- Create reject: flag off, vehicle inactive, rate placeholder, courier type allowed nahi, weight paar, prohibited confirm nahi, quote expire.
- Har config/staff action audit_logs me before/after.

## Staff RPCs (backend abhi)

force reassign, force cancel, refund, resolve incident, set service flag, vehicle/rate/courier-type CRUD — sab role-checked + audited.

## Notifications

Har status change par existing engine: customer (rider mila, pohoncha, picked, transit, delivered, cancel/refund) aur rider (offer, assign, cancel, earning credit). Rider na mile to ops alert.

## Migrations

1. Config tables + seed (courier flag OFF, bike inactive, placeholder rates, courier types, mapping) + Vault OTP secret.
2. courier_orders / secrets / events / offers + RLS + grants + transition guard + event trigger.
3. RPCs + sweeper function + naya cron job.
4. **Alag apply**: existing booking create path me service_flag check — **missing flag row = active** (fail-open), taaki koi existing service band na ho. Iske saath rollback SQL milega (check hatane ka aur poore courier schema ko drop karne ka).

Server side: `src/lib/courier.functions.ts` — Routes distance, Razorpay create purpose `courier`, webhook handling, refund call, AiSensy OTP send. Koi nayi Edge Function nahi.

## Verification

Typecheck, production build, DB linter, aur RLS tests **customer + rider role simulate karke** (`set local role authenticated` + JWT claim): cross-user order read deny, secrets table deny, config write deny, contact number masking, offer accept race test.

## Out of scope

Waiting charges, sab UI (customer/rider/Command Center), inter-city, multi-stop.
