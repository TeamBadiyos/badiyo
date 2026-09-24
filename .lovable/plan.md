# Courier rates: add customer segment (regular / corporate)

Today's prices stay exactly as they are. Every current rate becomes "regular", and every place that looks up a rate will only ever use regular rows. Corporate rows can be added later without affecting anyone.

## Changes
1. **New rate field:** customer segment, either `regular` or `corporate`. Default is `regular`, and all existing rates get `regular`.
2. **Max pickups / max drops:** these can now be left empty, which means "no limit". Regular rates must always have both filled in.
3. **One rate per city + vehicle + segment:** the current rule allows one rate per city + vehicle. It becomes one per city + vehicle + segment, and the city is matched ignoring capital letters and extra spaces.
4. **Rate lookups stay on regular:** four functions read the rates table. Each gets a filter so it only uses regular rates. Nothing else inside them changes.
   - `courier_quote_internal`: parcel price quote
   - `store_courier_fare`: shop delivery fee
   - `staff_courier_upsert_rate`: staff saves a rate
   - `staff_courier_confirm_rate`: staff confirms a placeholder rate

## Technical details
- `ADD COLUMN customer_segment text NOT NULL DEFAULT 'regular' CHECK (customer_segment IN ('regular','corporate'))`.
- `DROP NOT NULL` on `max_pickups` and `max_drops`. The existing `>= 1` checks stay; they pass automatically when the value is empty. New constraint: `customer_segment <> 'regular' OR (max_pickups IS NOT NULL AND max_drops IS NOT NULL)`.
- Drop constraint `courier_vehicle_rates_city_vehicle_type_id_key` (UNIQUE on `city, vehicle_type_id`). Create a unique index on `(lower(trim(city)), vehicle_type_id, customer_segment)`. Before swapping, check that existing rows have no city that collides once case and spaces are ignored. None of the four functions uses `ON CONFLICT`, so dropping the old constraint breaks none of them.
- For each function: read the full definition from the database, add `and customer_segment = 'regular'` to every SELECT/UPDATE/EXISTS lookup on `courier_vehicle_rates`, and recreate the function with the same signature, security settings and grants. Any INSERT in `staff_courier_upsert_rate` is left alone, since the column default already gives `regular`.
- Verify afterwards: re-run a price quote and a shop delivery fee for the demo shop, and confirm the amounts match what they were before the change.
- The reply will list all four functions by name.
