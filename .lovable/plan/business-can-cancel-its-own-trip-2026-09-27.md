# Business can cancel its own trip

Backend only. This uses the same cancel step that ops "Reject trip" uses, so there is still only one refund, and it comes from the existing order-cancel step.

## Behaviour

- **Who can cancel:** the owning business, meaning the owner, or staff with delivery permission. Another business's trip is refused.
- **When cancelling is allowed:** only while the trip is waiting for a rider, has a rider on the way, or the rider is at the pickup, and no pickup stop is done yet. After that it's refused with "Parcels already picked up".
- **Charges:**
  - **Before the rider reaches the pickup:** no fee and a full refund to the delivery wallet.
  - **Rider at the pickup:** the existing courier cancel fee applies (today 50% of the trip total, set in ops settings). The rest is refunded to the wallet. The rider gets the usual share of the fee (today 50%), is freed up, and gets the usual "cancelled" alert.
- **Afterwards:**
  - All the trip's orders go back to pending.
  - The trip is marked "rejected", with the reason.
  - The cancellation is recorded with who did it.

## Technical details

- **`business_reject_trip_internal(_cid, _reason)` becomes `(_cid, _reason, _by text, _allow_assigned boolean default false)`**:
  - Ops reject and the next-run auto-reject keep today's rule: no rider, still searching.
  - When `_allow_assigned` is true, it also accepts DRIVER_ASSIGNED and ARRIVED_PICKUP with no completed pickup stop.
  - At ARRIVED_PICKUP, the fee = round(total × `courier_setting('courier_cancel_fee_pct',50)`/100, 2). The rider's share = round(fee × `cancel_fee_expert_share_pct`/100, 2), credited to the rider wallet as 'courier_cancel_fee:<id>', exactly like `courier_cancel_order`. It also sets is_busy=false and sends `notify_expert_alert`.
  - It sets `cancellation_fee`. The existing `business_sync_from_order` trigger then sends orders back to pending and posts one wallet credit, 'refund:<id>' = total − fee. No new refund code is added.
- **Existing callers are updated to the new signature:**
  - `business_group_and_batch` (the next-run auto-reject)
  - `staff_business_reject_trip` (ops reject)
- **New `business_cancel_trip(_batch_id uuid, _reason text, _actor_label text)`** (security definer):
  - First calls `business_require_delivery()`, checks the trip belongs to the caller's business, and requires a reason.
  - Calls the internal step with `_allow_assigned=true`.
  - Sets the trip to 'rejected' and saves `fail_reason`.
  - Records it with `business_audit('business_cancel_trip','business_batches',id,before,after,_actor_label)`.
  - Returns fee, refund and rider share.
  - Anonymous users are blocked, signed-in users are allowed, and the function checks the caller itself.
- Every function changed is rebuilt from its live definition. I'll check every function it calls against its live signature, and read the definitions back after the change.
