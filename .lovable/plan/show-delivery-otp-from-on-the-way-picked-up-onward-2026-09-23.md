# Show delivery OTP from "On the way" (PICKED_UP) onward

## Problem
On the parcel tracking screen the 5th-stage tracker shows "On the way" as soon as the rider collects the parcel (status `PICKED_UP`), but the Delivery code card only appears at `IN_TRANSIT`. During `PICKED_UP` the customer sees no code at all and cannot share it with the delivery party.

## Root cause (verified)
- Client `src/components/courier/CourierTrackingScreen.tsx:141`: `otpPurpose` maps `delivery` only to `IN_TRANSIT`.
- Server gates enforce the same narrow window:
  - `courier_otp_owner_gate` (migration 20260919151717): `delivery` requires status `= 'IN_TRANSIT'`.
  - `courier_get_otp` (migration 20260919144743): same `= 'IN_TRANSIT'` check.

## Fix
Allow the delivery code from `PICKED_UP` through `IN_TRANSIT` (i.e. the whole "On the way" stage). Pickup code behaviour stays unchanged (`ARRIVED_PICKUP` only).

### 1. Database migration (new file in supabase/migrations/)
- `CREATE OR REPLACE FUNCTION public.courier_otp_owner_gate` — change the delivery check to
  `if _purpose = 'delivery' and _o.status not in ('PICKED_UP','IN_TRANSIT') then raise ... end if;`
- `CREATE OR REPLACE FUNCTION public.courier_get_otp` — same change to its delivery status check.
- Keep the existing `REVOKE ... FROM public, anon` and `GRANT EXECUTE ... TO authenticated, service_role` statements for both functions so permissions are restored exactly as they are today.
- Rollback note in a comment (restore the original `= 'IN_TRANSIT'` checks).

### 2. Client (src/components/courier/CourierTrackingScreen.tsx)
- `otpPurpose`: `status === "ARRIVED_PICKUP" ? "pickup" : (status === "PICKED_UP" || status === "IN_TRANSIT") ? "delivery" : null`
- The card copy "Share this code when the parcel is delivered." and the green WhatsApp button ("Send code on WhatsApp" → drop contact) already work for both statuses — no other UI change needed.

### Verification
- `bunx tsgo --noEmit` clean.
- Playwright 412×915 smoke test on a tracking screen: zero page errors.
- SQL check: simulate `courier_otp_owner_gate` returning successfully for a `PICKED_UP` order with purpose `delivery`.

## Out of scope
- No changes to pickup OTP, rider verification flow, or the Expert app.
