# Duplicate triggers check + lock unused functions

## 1. The two Command Center triggers (read from the live database)

**merchant_orders_stamp_steps** (runs before every shop-order update)
- Only fills in `accepted_at` (when status becomes accepted/preparing/ready/completed) and `ready_at` (ready/completed), and only if they are still empty. It never changes the status.
- Overlap: my backend already stamps `accepted_at`. Because this trigger skips a time that's already filled, both write the same value and never fight.
- Adds something mine doesn't: `ready_at` for the older shop flow (preparing → ready).
- Can it mark an order delivered without the OTP? No. It doesn't touch status, and my delivery-code guard still runs.
- **Decision: keep it on.**

**courier_orders_sync_merchant_order** (runs after a delivery job is created or updated)
- Only fires when the job has `merchant_order_id` set. It then copies the job id into the shop order and fills in `picked_up_at`. It never changes the status.
- My flow links jobs through `store_order_id` and never sets `merchant_order_id`. So for our store orders this trigger never runs (0 delivery jobs use it today). No conflict and no double writes.
- Adds something mine doesn't: a `picked_up_at` time on the shop order. My sync only moves the status to picked_up and doesn't record that time.
- **Decision: keep it on.** It is harmless but, today, never runs for store orders.

Neither trigger duplicates or fights the status sync, so nothing gets disabled. Optional follow-up (not in this change unless you say so): have my sync also fill in `picked_up_at` / `delivered_at` so the shop sees those times.

## 2. Lock unused functions
Remove signed-in and public access (no drop) from:
- `staff_reassign_store_rider(uuid, uuid)`
- `staff_cancel_store_order_apply(uuid, text, text, text, numeric)`
- `staff_commerce_admin_id()`

Today only `authenticated` has access, so revoke from `public, anon, authenticated`. The server (`service_role`) and owner keep access.

## 3. Re-run the full test on a temporary order, then undo it
One transaction that is rolled back at the end, using the demo store, address and user:
- Create order → webhook marks it paid → placed, stock goes down.
- Shop accepts → linked delivery job is created, already paid → Expert search starts.
- Assign an Expert → expert_assigned. Arrive, then the pickup OTP is verified → picked_up (and check whether `picked_up_at` gets filled).
- Delivery OTP is verified → delivered. A direct "delivered" update is blocked.
- Second order: reject with a reason → rejected, stock put back, refund queued.
- Check the triggers' `accepted_at` / `ready_at` stamps, the audit log count, and that nothing is left behind afterwards.

Report pass/fail for each step.
