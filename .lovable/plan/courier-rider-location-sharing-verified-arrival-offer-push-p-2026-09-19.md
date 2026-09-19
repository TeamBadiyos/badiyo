# Courier: rider location sharing, verified arrival, offer push payload

Backend only (database RPCs + push payload). No UI in this change. Courier service stays OFF.

## 1. Rider location for the customer

New RPC `courier_get_rider_location(order_id)`:
- Only the order owner (customer) can call it. Riders, other customers and signed-out callers are rejected.
- Only works while the order is `DRIVER_ASSIGNED`, `ARRIVED_PICKUP`, `PICKED_UP` or `IN_TRANSIT`. Before and after that it returns nothing.
- Returns only `lat`, `lng`, `location_updated_at` — no rider name, phone, photo or id.
- Rate limited per customer (new setting `courier_location_read_per_min`, default 12 — roughly one read every 5 seconds).
- Returns a stale marker when the last fix is older than `courier_location_stale_seconds` (default 120) so the UI can later show "last seen".

## 2. Verified arrival at pickup

`courier_rider_advance(..., 'ARRIVED_PICKUP')` gets new optional parameters `accuracy_m` and `fix_at` and now requires a fresh device fix instead of trusting the stored rider position:
- Fix age must be within `courier_fix_max_age_seconds` (default 60).
- Accuracy must be within `courier_fix_max_accuracy_m` (default 100).
- Distance from pickup within the existing `courier_geofence_meters` (default 200).
- Each failure returns a specific reason (`fix_stale`, `fix_inaccurate`, `too_far_from_pickup`) so the rider app can tell the rider what to fix; nothing is written and no OTP is issued.
- A short grace window is applied only while the older rider build is still live: when `accuracy_m`/`fix_at` are not sent at all, the current geofence-only behaviour is kept (controlled by `courier_require_fresh_fix`, default `false` → flip to `true` once the new rider APK ships).

Every rejected attempt is written to the order's event history for support.

## 3. Courier offer push payload

The rider offer push currently reuses the home-service broadcast (`alert_type: new_order`, `type: new_booking_broadcast`). It becomes a courier-specific payload:
- `type: courier_offer`, `alert_type: courier_offer`, `order_id`, `offer_id`, `expires_at`, `pickup_area` (first line of the pickup address only), `drop_area`, `trip_km`, `earning`.
- No phone numbers, no full addresses, no customer name.

## 4. Old rider app safety flag

What the code shows: the only messaging service in this repo is the **customer** app's, and it rings the full-screen alarm strictly by `alert_type` (`order_completed`, `reminder_10min`, `extension_decided`) — anything else is handled as a normal notification. The rider app's `BadiyoMessagingService` is not part of this project, so its behaviour cannot be confirmed from here.

So we assume the worst case and add `courier_native_alert_enabled` (default `false`):
- While `false`: courier offers are sent as a plain notification-style alert with a neutral `alert_type` the old app will not treat as a booking ring; the courier fields still ride along in the data.
- When `true` (after the new rider APK ships): the full `courier_offer` alert type is sent for the native ringing screen.

Note: the actual FCM message (notification block vs data-only) is assembled by the deployed `send-push-notification` function, whose source is not in this project. We pass an explicit `push_mode` hint plus the flag; if that deployed function ignores it, it needs one small matching change — I will flag it after testing rather than guess.

## 5. Location update rate

`expert_update_location` gets a 15-second server-side throttle: a newer fix arriving sooner than `courier_location_min_interval_seconds` (default 15) is accepted silently without a write, so the rider app can post as often as it likes without extra database load.

## 6. Tests

RLS/permission matrix run as customer, second customer, rider and signed-out, plus rate limit, stale/inaccurate/far fix cases and the throttle. Results reported as a table.

## Technical notes

- All new/changed functions: `SECURITY DEFINER`, `SET search_path = public`, `EXECUTE` revoked from `PUBLIC`/`anon`, granted to `authenticated` + `service_role`.
- Rate limiting reuses the existing `courier_quote_log` pattern with a new small log table for location reads, pruned by the existing sweeper tick.
- New `ops_settings` keys: `courier_location_read_per_min`, `courier_location_stale_seconds`, `courier_fix_max_age_seconds`, `courier_fix_max_accuracy_m`, `courier_require_fresh_fix`, `courier_native_alert_enabled`, `courier_location_min_interval_seconds`.
- No pricing, dispatch, refund or OTP logic changes.
