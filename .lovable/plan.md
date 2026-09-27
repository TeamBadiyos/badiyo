# Qty trigger: only full trips leave early

Each change is rebuilt from its live definition (pg_get_functiondef), and the planner code is edited in place.

## Behaviour

- **The planner picks the number of trips.** It is offered one vehicle per drop. Each trip carries a fixed cost (new dispatch-plan setting "trip fixed cost") on top of travel time. A far drop in another direction becomes its own trip, because adding it to a nearby route would cost more time than the trip's fixed cost.
- **Qty trigger:**
  - It runs at most once every 5 minutes per business and pickup point, and only when pending drops >= the threshold.
  - It plans all pending drops, but only trips with at least as many drops as the threshold are created, charged and sent to riders.
  - Orders on smaller trips go back to pending with no charge, and are planned again at the next check, slot or manual dispatch.
  - If no trip reaches the threshold, nothing is dispatched and nothing is charged.
- **Slot and manual triggers:** unchanged. Every trip goes out, small ones included.
- **Held-back count:** each run records how many drops were held back, and this is logged.

## Technical details

**Database (one migration):**
- `bulk_dispatch_plans.trip_fixed_cost numeric null` (0 or more). When it is null, the effective value is the business's pricing plan `base_fare`. `staff_upsert_dispatch_plan` accepts it; the exact name is taken from the live list.
- `business_dispatch_state` adds `last_qty_check_at timestamptz`, keyed by merchant. For per-pickup throttling, a new small table `business_qty_check_state(merchant_id, pickup_point_id, last_check_at, pk both)` is added, with RLS enabled, no client policies, and a service_role grant.
- `business_orders_qty_check`: after the count is >= the threshold, it takes a row lock and skips if the last check was less than 5 minutes ago. Otherwise it stamps the time and calls `business_group_and_batch(...,'qty',...)`. This also stops one group of bulk inserts from starting several runs.
- `business_dispatch_runs` adds `held_drops int not null default 0` and `min_trip_drops int` (the threshold is stored only for qty runs).
- `business_group_and_batch`: for 'qty' runs, it stores `min_trip_drops = qty_threshold`.
- `business_claim_planning_runs`: it also returns `trigger`, `min_trip_drops` and `trip_fixed_cost` (coalesced to the pricing plan's base_fare) for each run.
- `business_create_trip`: when the run has `min_trip_drops` and there are fewer receivers than that, it creates nothing and returns `{held:true}`. This is enforced in the database, so the worker can't bypass it.
- `business_complete_run` (released orders already go back to pending with the run cleared):
  - It sets `held_drops` = the number of distinct receivers released that were not skipped by Google.
  - It marks the run 'done' with 0 trips when everything was held.
  - It writes a `raise log` line plus an audit row, `business_audit('business_dispatch_held', ...)`, when held_drops > 0.

**Planner (`process-batches.ts`):**
- **Google optimizeTours:**
  - vehicles = number of drops.
  - Each vehicle gets `fixedCost = trip_fixed_cost`, `costPerHour` as today, and a load limit of max_drops. Empty routes are ignored.
- **Fallback:**
  - Bearing groups as today.
  - A drop is added to a group only if its extra detour (haversine × 1.3 km × pricing plan per_km) is <= trip_fixed_cost. Otherwise it starts its own trip.
  - Near drops within 1 km follow the same rule.
- The number of held-back trips is logged to the console.

**Rollback test (written, not run):** it simulates the worker by calling `business_create_trip` with the groups the fallback would make.
1. Setup: a merchant, ₹1000 wallet credit, dispatch plan (qty 3, max 10) and pricing plan. Receivers: N1 and N2 within 1.5 km of the pickup, and F at 15 km in the opposite direction, all checked for serviceability.
2. Insert 3 orders. The qty trigger starts a run. Trips [N1,N2] and [F] are both held; run → done, trips=0, held_drops=3; wallet unchanged; all orders pending.
3. Clear the 5-minute throttle inside the test, then add N3.
   - The new run gives trip [N1,N2,N3], which is dispatched and charged once.
   - [F] is held: held_drops=1, and F's order is pending with the run cleared.
4. Manual `business_group_and_batch`: F goes as its own 1-drop trip and is charged.
5. The test ends with `RAISE EXCEPTION 'TEST OK (rolled back) || ...'`.
