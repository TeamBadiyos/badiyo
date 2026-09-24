# Merchant Hub backend fixes

## 1. Shop can mark Ready on Expert-delivered orders
- `merchant_advance_order`: for orders with a linked delivery job, allow **only** a move to Ready from `accepted` or `expert_assigned`. The Rider can be assigned before or after the shop is ready. Input `packed` or `ready` is accepted, and the order is saved as the existing `ready` status. Every other shop status change on these orders still fails with `delivery_managed_by_expert`. Older non-Expert orders keep their current flow.
- Status sync fix: if the Rider gets assigned after the shop marked Ready, the order stays `ready`. It does not drop back to `expert_assigned`. Pickup still moves it to `picked_up`, and only the delivery OTP marks it delivered.
- Customer app: the tracking screen and the Orders tab treat `ready` as "Store accepted / packed". Once a Rider is assigned, the tracking screen shows the Rider step, so a ready order doesn't lose the step marker.
- Ready time: the existing stamp trigger fills in `ready_at`.

## 2. New `merchant_get_order_rider(order_id)`
- Returns `{ name, phone }` only when the caller is that order's shop (owner or staff, same check as the other shop functions). It also needs the order to be in `expert_assigned`, `ready` with a Rider assigned, or `picked_up`. In every other case it returns nothing (null).
- The data comes from the linked delivery job's assigned Expert. Signed-in users can call it. Public access is revoked.

## 3. Save pickup and delivery times
- The status sync fills in `picked_up_at` when pickup is verified (`PICKED_UP`) and `delivered_at` when delivery is verified. Each time is only written if it's empty.

## 4. Test order TEST-93788 (demo shop)
Current state: rejected, OUT_OF_STOCK, `refund_status = done`, `payment_status = refunded`, no payment id. The refund worker already skips orders without a payment id and marks them "done", so it is **not** retrying. But the order wrongly says "refunded".
- Data fix: set `refund_status = 'none'`, `refund_amount = 0`, `refund_reason = 'not_required: test order, no payment'`, `payment_status = 'unpaid'`.
- Worker fix: from now on, orders with no real payment are marked "not required" the same way, instead of "refunded".
- How to do it later by hand: in the SQL editor, run an update on that order setting those four fields. Or have MyAdmin call the admin cancel function on orders that have no payment.

## 5. Re-test on temporary orders, then undo
One rolled-back transaction on the demo shop:
- accept → linked job → Expert assigned → **shop Ready succeeds** → another shop change (e.g. completed) is blocked
- `merchant_get_order_rider`: returns the name and phone for the shop, null for another user, and null after delivery
- pickup OTP → `picked_up`, `picked_up_at` filled
- delivery OTP → `delivered`, `delivered_at` filled
- A second variant: Ready before the Rider is assigned, and the status stays `ready`
- Report every step. Confirm nothing is left afterwards and stock is back to what it was.
