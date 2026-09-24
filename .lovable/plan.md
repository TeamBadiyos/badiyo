# Store orders delivered by the existing courier (Expert) flow

## What exists today (checked in the live database)

| Area | Current state |
|---|---|
| Store orders (`merchant_orders`) | Statuses: pending, paid, accepted, preparing, ready, completed, rejected, cancelled. Live data: 1 old COD order (completed). Has payment_mode, payment_status, razorpay ids, delivery_fee, delivery lat/lng. No courier link. |
| Store fee | `store_delivery_quote` = flat Rs 25, free above Rs 299. Not the courier fare. |
| Store payment | `store_create_order` → `create-razorpay-order` (purpose store_order) → `store_confirm_payment` (app) + `system_store_mark_paid` (webhook). Order goes to `paid` from the app too, not only the webhook. COD allowed. Stock is only checked, never reduced. |
| Merchant actions | `merchant_decide_order` (accept/reject from `pending` only, no reason, no refund) and `merchant_advance_order` (accepted → preparing → ready → completed). Merchant can mark "completed" itself. |
| Courier jobs (`courier_orders`) | REQUESTED → SEARCHING → DRIVER_ASSIGNED → ARRIVED_PICKUP → PICKED_UP → IN_TRANSIT → DELIVERED → COMPLETED, plus CANCELLED / FAILED_DELIVERY. Has refund_status pipeline, needs_ops_attention. Live: 4 rows. |
| Courier fare | `courier_quote_internal(customer, city, vehicle, courier_type, distance_km, weight, coupon)` from rates table (base, included km, per km, min, platform fee, GST). |
| Dispatch | `courier_start_dispatch` (needs REQUESTED + paid) → `courier_dispatch_next`, offers, radius expand and timeout via the existing sweeper cron. |
| OTPs | `courier_order_secrets` stores only hashes; code is derived by `courier_issue_otp` / `courier_derive_otp` (HMAC). Expert enters via `courier_verify_otp` (pickup at ARRIVED_PICKUP, delivery at IN_TRANSIT). Customer reads with `courier_get_otp` (owner only). |

## What will change

1. **Checkout fee = courier fare, online only**
   - New `store_quote_delivery(merchant, address)`: pickup = store lat/lng, drop = address, smallest active 2-wheeler, "Grocery/Other" parcel type, distance from the existing route/haversine logic; fee from the same pricing as `courier_quote_internal` (shared core, without the customer quote rate-limit and coupon). 
   - `store_create_order` uses that fee, rejects `cod`. Total = items + fee.
   - Cart screen: COD toggle removed, bill shows the real delivery fee.

2. **Order reaches merchant only after webhook**
   - `store_confirm_payment` (app) no longer marks paid; it only records "awaiting confirmation".
   - Webhook `system_store_mark_paid` (signature already verified, idempotent on payment id) → status `placed`, paid_at, and reduces stock in the same transaction. If stock is gone by then → auto reject + refund.

3. **Merchant accept creates the courier job**
   - `merchant_decide_order` extended: accept from `placed` → `accepted`, inserts a linked `courier_orders` row (new column `store_order_id`, unique): pickup = store name/address/phone, drop = customer address/phone, payment_status paid, total = checkout delivery fee, fare snapshot copied. Then calls existing `courier_start_dispatch`.
   - Merchant Hub keeps calling the same function name, so no merchant-app change is needed for accept.

4. **OTPs** — reuse `courier_issue_otp` / `courier_verify_otp` unchanged. New `merchant_get_pickup_otp(order)` (merchant of that store only) and customer `store_get_delivery_otp(order)` (order owner only), both reading the linked courier job via the existing derive logic.

5. **Status sync** — trigger on `courier_orders` status change for linked jobs: DRIVER_ASSIGNED → `expert_assigned`, PICKED_UP → `picked_up`, DELIVERED → `delivered`, CANCELLED → back to `accepted` with admin alert. Merchant can no longer set completed/delivered for courier-delivered orders (`merchant_advance_order` blocks it); only the Expert delivery OTP path does.

6. **Reject / timeout** — reject requires a reason. Sweeper step: `placed` older than N minutes (`store_accept_timeout_min`, default 5, in settings) → `rejected`. Both set refund_pending; refunds processed by the existing refund route pattern (new store branch in the process-refunds route, same Razorpay idempotency key style).

7. **No Expert found** — when the courier sweeper times out a linked job, instead of auto-cancel: store order → `needs_attention`, row in the existing admin alert queue. New staff RPCs `staff_store_reassign(order)` (restart dispatch) and `staff_store_cancel_refund(order, reason)`.

8. **Audit + safe mapping** — every store status change writes `audit_logs` (before/after, actor). Old statuses kept valid: `pending` (unpaid), `paid` treated as `placed`, `ready`/`completed` left as-is for old orders. The one existing COD order is untouched.

## Customer app
- Cart: online only, courier-based fee, "Order sent to shop after payment confirms" message.
- Orders screen: new statuses (Placed, Accepted, Expert assigned, Picked up, Delivered, Rejected/Refunded) and a delivery code card once picked up.

## Not in this plan (other apps)
- Merchant Hub screen showing the pickup code and reject-reason input, and MyAdmin buttons for reassign/cancel — the backend functions will be ready; those UIs live in the other projects.
- Expert app: no change, it sees these as normal courier jobs.

## Technical notes
- One migration: columns (`courier_orders.store_order_id`, `merchant_orders.courier_order_id`, reject_reason, refund fields, placed_at), settings keys, functions above, trigger, sweeper step, grants/revokes (anon revoked, internal fns service_role only).
- Pricing core extracted from `courier_quote_internal` into an internal helper so both paths share one formula; existing parcel behaviour unchanged.
- Code: `create-razorpay-order` store branch unchanged in amount logic; webhook store branch; process-refunds store branch; `storeOrders.ts`, `StoreCartScreen.tsx`, `OrdersScreen.tsx`, i18n.
- Verification: simulated role tests for create → webhook paid → accept → courier row + dispatch → OTP verify sync → delivered; reject/timeout refund_pending; anon denied; typecheck.
