# Multi-stop parcel: groundwork only (phase 1)

This step only adds new storage. The app, prices, OTPs, payments and all current orders keep working exactly as they do now. Nobody sees any change yet.

## What gets added
- **Parcel prices per vehicle**: 5 new settings: extra pickup fee, extra drop fee, max pickups, max drops, return price per km. By default they're set so nothing changes (fees 0, max 1).
- **Parcel orders**: 3 new fields: number of pickups, number of drops, stops fee (defaults 1 / 1 / 0). Customers can't edit them from the app.
- **New records**:
  - Stops: each pickup, drop or return point of an order, with its contact and status.
  - Stop codes: a private OTP record for each stop. Nobody using the app can ever read it.
  - Parcels: what goes from which pickup to which drop, with an optional return.
  - Extra charges: return trip charges with GST and payment status.
- **Automatic stops**: every new parcel or store delivery job gets a pickup stop, a drop stop and one parcel created automatically. Later, multi-stop booking can switch this off and add its own stops.
- **Existing orders (5 today)**: each one gets matching stops and a parcel, with statuses copied from its history. The orders themselves aren't touched.

## Who can see the new records
They follow the same rules as parcel orders today: the customer who owns the order, the rider assigned to it, and ops staff. Nobody can add or change these records from the app. Stop codes can't be read by anyone.

## Technical details
- One migration. The confirmed `courier_orders` columns used are `arrived_pickup_at`, `picked_up_at`, `delivered_at`, `incident_code` and `package_description`. The existing `update_updated_at_column()` is reused for the `updated_at` triggers.
- `courier_orders_guard` is read first. The only edit is adding `pickup_count`, `drop_count` and `stops_fee` to its list of protected columns. Nothing else in it changes.
- RLS is on for all 4 tables. The SELECT policies go through `order_id`, using `customer_id = auth.uid()`, `assigned_expert_id = get_expert_id_for_auth(auth.uid())` or `courier_is_ops_staff()`. There are no write policies and no policy on the stop-codes table. Grants: SELECT to authenticated, ALL to service_role, none to anon.
- A validation trigger on parcels checks that each stop is the right type and belongs to the same order.
- An AFTER INSERT trigger on `courier_orders` creates the default stops. It skips when `app.courier_skip_default_stops = 'on'`.
- The backfill only inserts into the new tables, using the status rules from your spec. It never updates `courier_orders`, so no order triggers fire. Stop codes aren't backfilled.
- Afterwards: types regenerate, then a check that each of the 5 orders has 2 stops and 1 parcel. A test order and a test store job, both rolled back, confirm the automatic stops, the skip switch and that the order flow still works.
