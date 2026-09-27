# Rebuild business dispatch around Google Route Optimization

Backend only. Existing courier, store and customer flows stay the same. Every function change starts from its live definition in the database, never from memory.

## What changes

1. **Dispatch plan setting:** a new "service minutes per drop" setting (default 3, allowed 1–15). "Max drops per batch" (default 10) is the drop limit for each trip. Trips have no time limit.
2. **Dispatch run** (one per business and pickup point, started by slot, manual or order count):
   - Order count now counts all pending drops at that pickup point. Zones are no longer used to group orders.
   - Any earlier trip from that pickup point that still has no rider is rejected first. Its orders go back to pending and the wallet is refunded once.
   - All pending orders are taken, and orders for the same receiver become one drop.
   - A new run record is saved. The orders are marked batched and linked to the run, then the route planner is woken. Orders created after this wait for the next run.
3. **Route planner:**
   - It calls Google Route Optimization with the number of vehicles = drops ÷ max drops, rounded up. Each vehicle starts at the pickup point, the goal is the least total travel time, and each drop takes the set service minutes.
   - Each route becomes a trip with:
     - a trip number
     - stops in exactly Google's order
     - Google's distance
     - a label from the zone that holds most of its drops
     - drop labels C1, C2, and so on
   - Each trip is then finalized as today: fare from the plan, wallet debit, courier order, rider search.
   - Drops Google skips go back to pending and are noted on the run.
   - **Backup if Google fails:** drops are grouped by direction from the pickup. A new group starts after a gap of more than 60 degrees or when a group is full. Drops within 1 km join the nearest group. Stops are ordered with the existing planner, and distance is straight line × 1.3.
4. **No rider:** business trips no longer auto-cancel. They keep searching and are flagged "Unassigned" for ops, who can assign a rider or reject the trip. Rejecting sends the orders back to pending with one refund. Trips still unassigned are rejected at the next run.
5. **Slot heads-up:** 15 minutes before each slot, online Bulk Delivery riders get a push: "<time>: trips ready soon at <business>".
6. **Business code view:** it also returns the trip number, trip label and drop labels.
7. **Report and test:** I'll list every change and write a rollback test script (not run) that uses the backup path. The test covers:
   - 30 generated drops with a limit of 10 per trip, giving 3 trips
   - every drop placed exactly once
   - a wallet debit for each trip
   - one trip left unassigned, then rejected by the next run with its refund

## Needed from you

- A Google Cloud service account key with the Route Optimization API enabled. I'll ask for it securely as `GOOGLE_ROUTE_OPT_SA_JSON`. Until it's added, every run uses the backup path.

## Technical details

- **Migration:**
  - `bulk_dispatch_plans.service_minutes_per_drop` (validation trigger allows 1–15)
  - new table `business_dispatch_runs` (GRANTs, RLS so the owning business and ops can read it)
  - new columns `business_orders.dispatch_run_id`, `business_batches.dispatch_run_id`, `trip_no`, `trip_label`, `drop_labels jsonb`, and `courier_orders.needs_ops_attention`
- **Rewritten from their live definitions:**
  - `business_group_and_batch`: per pickup point, no zone grouping, rejects earlier trips first, creates the run, reads no `batch_capacity`, uses `truncate` for temp tables
  - the order-count trigger
  - `business_slot_tick`: adds a 15-minute heads-up with a per-slot record so it's sent once
  - `business_claim_planning_batches`, replaced by a function that claims runs
  - `business_finalize_batch` / `courier_create_business_order`: accept the trip number, labels and a fixed stop order
  - the courier no-rider path: skipped for business orders, which get the flag instead
  - `business_get_trip_otps`
- New actions for ops: list unassigned trips and reject a trip, reusing the force-cancel and refund logic.
- **Processor:**
  - signs a service-account token with Web Crypto (RS256), then calls `routeoptimization.googleapis.com/v1/projects/{id}:optimizeTours`
  - sets `costPerHour` on vehicles, a load limit of max drops, and `travelMode` DRIVING
  - runs the bearing-based backup in TypeScript
  - checks the secret header as it does today
- The Google call is made directly with the service account, not through the connector gateway, as the brief asks.
- The test script is checked against the live function signatures before I hand it over.
