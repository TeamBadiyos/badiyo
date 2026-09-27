# Fix "record is not assigned yet" on trips without a rider

Backend only. The test script needs no changes.

## What's wrong

Two functions fill the rider's details only `if assigned_expert_id is not null`, then read those details when building the result. When a trip has no rider, the details were never filled in, so the function crashes. This happens even when the value sits inside a CASE branch that would never run.

## Fixes (each rebuilt from its live definition)

1. **`business_get_trip_otps`**
   - Replace `_r record` with plain `_rider_name text` and `_rider_phone text`, and read them with `select name, phone into _rider_name, _rider_phone`.
   - Return them as `rider_name` and `rider_phone`. They're null when there's no rider.
   - Point 2 of your request is already done, so there's no TODO. `cancel_fee_preview` already uses `courier_cancel_fee_for` (fee including GST on the fee), and `refund_preview` = trip amount − that fee.

2. **`courier_get_contact_view`** (what a stop contact sees)
   - Same pattern: `_e` is only filled when a rider is assigned, but `_e.name` and `_e.photo_url` are read in the result.
   - Switch to plain `_rider_name` and `_rider_photo` text variables, so an order still searching for a rider no longer crashes for the contact.

Everything else in both functions stays exactly as it is.

## Search results: all business_* and courier_* functions

I checked every PL/pgSQL function in these two groups that declares a `record` variable:

- **Filled by a loop only, never read outside it (safe):** business_claim_planning_batches, business_claim_planning_runs, business_group_and_batch (`_c`, `_r`), business_slot_tick, courier_dispatch_next, courier_recompute_order_progress, courier_rider_advance, courier_rider_fail_stop, courier_sweeper, courier_sweeper_tick.
- **Always filled before any read (safe):** a SELECT INTO that runs but finds nothing leaves the fields null rather than crashing. This covers business_get_trip_rider, courier_get_rider_info, courier_get_rider_location, courier_get_rider_location_for_stop, and business_group_and_batch (`_p`, which is also checked for null right away).
- **Filled from a helper that always returns one row (safe):** business_reject_trip_internal and courier_cancel_order (`_f` from `courier_cancel_fee_for`).
- **Filled only inside an IF, then read (the bug):** business_get_trip_otps and courier_get_contact_view. Both are fixed above.

## Checks after applying

- Read both definitions back and confirm the new variables are used.
- Check that every call inside them still matches its live signature.
- Run the linter. No new warnings are expected, because grants and security settings are unchanged.
