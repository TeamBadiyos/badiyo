# Failed stops, returns and return charges (backend only)

No screen changes. The normal pickup-and-deliver flow behaves exactly as it does today.

## Current state (checked)
- Parcel orders go ARRIVED_PICKUP → CANCELLED (allowed today) and IN_TRANSIT → DELIVERED / FAILED_DELIVERY. No status-rule change is needed: an order can't be "picked up" without at least one picked parcel.
- Refunds for parcel orders only start when a refund is explicitly queued. Cancelling with reason ALL_PICKUPS_FAILED queues none, so no refund happens.
- How settlement runs today: `courier_settle_order` is called by the background `courier_sweeper` and by staff incident resolution. It pays the rider for DELIVERED orders (full fare minus commission) and FAILED_DELIVERY orders (a set % of the base fare). Anything else is skipped.
- The return-charge table already has everything needed (type, distance, amount, GST, total, status, Razorpay order/payment id, paid time).
- Parcel payments create a Razorpay order in the app's server code, and the payment webhook lives in the app.

## Steps
1. **Settings:** `courier_fail_wait_minutes` (10) and `courier_return_payment_escalation_minutes` (15), read with the existing setting helper.
2. **Shared progress helper** `courier_recompute_order_progress` (server only):
   - When all pickups are done: cancel the order (no refund) if nothing was picked up; otherwise move to "in transit" and issue codes for the drops.
   - Cancel drops that have no picked parcels left.
   - Close the order as delivered or failed once every stop is done.
   - `courier_verify_stop_otp` is refactored onto this helper with the same results for normal orders.
3. **`courier_rider_fail_stop`** (assigned rider only):
   - Allowed only after the wait time at the stop. Before that it errors with "You can mark this after X minutes at the location".
   - Failed pickup: that pickup's parcels are cancelled.
   - Failed drop: parcels switch to "returning". The parcels are linked to an open return stop for their pickup, or a new one is created.
   - A new return is charged per km at the city's regular rate plus GST. The driving distance comes from the rider app and is checked against the straight-line distance (error RETURN_DISTANCE_INVALID). A ₹0 charge is marked waived.
   - Issues the return code, notifies the customer, then runs the helper.
4. **Return stops in the rider flow:**
   - A rider can arrive at a return stop only after all drops are finished.
   - Verifying a return stop while its charge is unpaid returns "payment_pending" with the amount. This doesn't count as a wrong code.
   - A correct code marks the parcels "returned".
   - Riders can't mark a return stop as failed.
5. **Paying the return charge:**
   - New app server function `createReturnChargePayment(charge_id)`: order owner only. The amount comes from the database, using the same Razorpay setup as parcel payments plus `charge_id` in the payment notes.
   - `courier_mark_charge_paid` (server only, safe to run twice): records the payment, logs it and notifies the rider.
   - Webhook: after the existing signature check, one new branch runs only when the payment's order id matches a return charge. Existing booking, parcel, tip and store branches are untouched.
   - `staff_courier_waive_charge` (ops staff only): waives a charge, with an audit log entry.
6. **Escalation:** in `courier_sweeper_tick`, a customer who has been waiting at a return stop with an unpaid charge longer than the setting gets the order flagged for ops once, with the existing admin alert.
7. **Settlement:**
   - Paid return charges are added to the rider's earnings, minus the same commission.
   - Orders cancelled with ALL_PICKUPS_FAILED are settled like delivered orders.
   - The sweeper's selection will be checked and widened only for that cancel reason. Normal delivered orders get identical payouts (extra charges only exist on orders with returns).
8. Unchanged: `courier_report_incident`.

## Checks after building
- Typecheck of the app changes.
- Search confirming each existing webhook branch is unchanged.
- List of every function created or changed.
- A roll-back SQL test script you can run, like last time. I can't run these functions myself.
