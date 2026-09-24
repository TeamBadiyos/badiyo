# Parcel OTP access for owner and stop contacts (backend only)

No UI changes. `courier_get_otp`, `courier_get_rider_info`, `courier_get_rider_location` and all existing callers keep working as they do today.

## Where the phone number comes from
- First choice: the phone confirmed at OTP login, stored in `auth.users.phone`.
- Fallback: `public.users.phone`, the profile number, used only when the login phone is empty.
- A shared server-only helper, `courier_my_phone10()`, returns the last 10 digits, or null if there is none. Stop phones get the same treatment: strip everything that isn't a digit, then keep the last 10.
- Deleted accounts (`users.deleted_at` set) get no contact access.

## 1. `courier_get_order_otps(_order_id)` (order owner)
- Uses the same owner check as `courier_otp_owner_gate`: signed in, and `customer_id = auth.uid()`.
- Returns every stop in sequence: stop_id, stop_type, sequence, address, contact_name, contact_phone, status, otp.
- `otp` is filled in only when all of these hold: the stop has an issued code, the code hasn't expired, the code isn't verified yet, and the stop isn't finished (completed, failed or cancelled). The code is derived the same way as `courier_get_otp`. Otherwise `otp` is null.
- The "should this code be shown" rule lives in a server-only helper, `courier_stop_visible_otp(_stop_id)`, so every function below uses the same rule.

## 2. Contact access
**a. `courier_my_contact_deliveries()`**
- Lists stops where the stop's phone matches the signed-in user's phone and the order is not theirs.
- The order must be active, or finished less than 24 hours ago (going by the delivered, cancelled or updated time).
- Each row: order_id, order_code, stop_id, role, the stop's address and status, order status, and a sender label. For drop and return stops, the label is the first pickup contact's name. For pickup stops, it's the customer's first name.

**b. `courier_get_contact_view(_stop_id)`**
- Works only when the signed-in user's phone matches that stop's phone. Otherwise it returns "Forbidden".
- Returns:
  - the stop's details and status
  - the order status
  - the rider's name, vehicle and photo (the same as the owner sees, plus vehicle type)
  - `is_next_stop`: true when a rider is assigned and this is the first unfinished stop in sequence
  - this stop's code, using the rule from point 1
- For a pickup contact, it also returns the code of any return stop linked to their pickup, found through the parcels' `return_stop_id`.
- Never returns other stops, other codes, fares, charges or payment data.

**c. `courier_get_rider_location_for_stop(_stop_id)`**
- This is a new function; the existing `courier_get_rider_location` is left untouched.
- Checks the same phone match, and allows the read only while `is_next_stop` is true.
- Uses the same 12-per-minute limit (`courier_location_read_log`, counted per user) and the same staleness rule. It returns the same shape as the owner version.

All four new functions are security definer, callable by signed-in users only, and not callable by signed-out users.

## 3. App notification to contacts who have the app
- A new server-only function, `courier_notify_stop_contact(_stop_id)`, finds a customer account whose phone matches the stop's phone. It skips the order owner and deleted accounts, then calls `notify_customer_user_push(user, 'Parcel update', 'Open Badiyos to see your OTP', '/')`. The code itself is never in the text.
- It's called from the end of `courier_issue_stop_otp`. That single place covers pickup arrival, drop codes when the parcel is in transit, and return stops. The code-creation logic itself doesn't change.
- If the notification fails, the code is still issued; any error is swallowed.

## 4. Server functions (`src/lib/courier.functions.ts`)
Four new server functions, each requiring sign-in and running as the signed-in user:
- `courierGetOrderOtps`
- `courierMyContactDeliveries`
- `courierGetContactView`
- `courierGetRiderLocationForStop`

## Functions created or changed
- New: `courier_my_phone10`, `courier_stop_visible_otp`, `courier_get_order_otps`, `courier_my_contact_deliveries`, `courier_get_contact_view`, `courier_get_rider_location_for_stop`, `courier_notify_stop_contact`
- Changed: `courier_issue_stop_otp`. The only change is the notification call added at the end.
- Unchanged: `courier_get_otp`, `courier_get_rider_info`, `courier_get_rider_location`, `courier_otp_owner_gate`

## Technical notes
- Everything goes in one migration.
- Grants: the four functions the app calls go to authenticated and service_role. The three helpers go to service_role only, with public and anon revoked.
- Checking the new functions end to end needs a signed-in session, which the read-only role doesn't have. It will be verified by reading back the function definitions, plus the type check.
