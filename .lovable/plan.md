# Allow "rejected" on business trips

## What was found (live database)

| Table | Allowed statuses today |
|---|---|
| business_batches | planning, awaiting_balance, dispatched, failed, completed |
| business_dispatch_runs | planning, done, failed |
| business_orders | pending, batched, in_transit, delivered, returned, failed, cancelled |

Status values written by functions, from a scan of every direct update:
- **business_batches:** awaiting_balance, dispatched, failed, planning are fine. **'rejected'** is written by `business_cancel_trip` and `staff_business_reject_trip`, and the next-run auto-reject reaches it through the same path. The constraint blocks it. This is the only mismatch found so far.
- **business_dispatch_runs:** planning is fine.
- **business_orders:** batched, cancelled, delivered, failed, in_transit, pending, returned are all fine.

## Changes

1. Drop `business_batches_status_check` and recreate it with `'rejected'` added, keeping the other five values.
2. Before writing the migration, finish the scan for writes that the update-only search misses: `INSERT ... status`, statuses set through variables or `CASE` (for example run 'done' / 'failed' in `business_complete_run`, and the processor route), and business_* / staff_business_* / courier_* functions that touch these three tables. Any other value missing from a constraint gets added in the same migration. Readers comparing against unknown values are reported, not changed.
3. Read the constraints back after the migration, and report the before and after for each one.

## Not changed
- No function bodies change, and the test script stays the same.
