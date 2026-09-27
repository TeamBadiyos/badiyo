# Add batch_id to staff_list_unassigned_business_trips()

## Current state (verified against the live database)

The live function `staff_list_unassigned_business_trips()` already returns `batch_id`
(second field, from `business_batches.id`), keeping every existing field:
courier_order_id, batch_id, order_code, status, merchant_id, business_name,
trip_no, trip_label, drops, total_amount, search_started_at, needs_ops_attention.

So no database change is needed.

The repo migration file `supabase/migrations/20260927102417_9d8c246e-...sql`
(lines 420-425) is stale: its copy of the function is missing the
`'batch_id', b.id` entry. A fresh environment replaying that file would lose
the field.

## Plan

1. Update the migration file's copy of `staff_list_unassigned_business_trips()`
   to add `'batch_id', b.id` after `'courier_order_id', c.id`, matching the live
   definition exactly. No SQL is executed against the database — the file edit
   only keeps the migration history in sync with what is live.
2. Re-read the file section to confirm the edit.

## Verification

- Live function definition already confirmed to return `batch_id` (read from
  `pg_proc` this turn).
- No unassigned business trips exist right now, so there is no live output to
  sample; the definition check is the verification.
