# Auto-settle fully returned orders + alert check + return test script

## 1. Auto-settle clean failed deliveries
Today the background job never pays riders for FAILED_DELIVERY orders. Staff pay them when resolving an incident, at 50% of the base fare.

Change (one migration):
- `courier_sweeper_tick` also picks up FAILED_DELIVERY orders where:
  - there is no incident code,
  - every stop (pickup, drop, return) is finished,
  - every return stop is completed,
  - the rider hasn't been paid yet.
- `courier_settle_order` pays those orders like delivered ones: full fare minus commission, plus paid return charges, then marks the order COMPLETED.
- FAILED_DELIVERY orders that have an incident code keep today's staff-resolved 50% rule. Delivered orders are unchanged.

## 2. Admin alert for unpaid returns (checked, no change needed)
- The alert sender does not filter by alert type. It sends every queued row with the same 4-value WhatsApp template, and the queue wakes it on every new row.
- The unpaid-return alert (order code, "Return charge unpaid", amount, "Now") is therefore sent the same way as existing ops alerts.
- One limit: the queue accepts only one alert per order per type, so a given order is escalated only once.

## 3. Return test script (written, not run)
- A downloadable SQL file you paste into the Supabase SQL editor.
- Setup:
  - acts as a real active rider,
  - turns on 2 pickups / 4 drops and return_per_km = 10 on the Latur regular rate,
  - uses 4 real past locations.
- It always ends with "TEST OK (rolled back) || {log}". Each step logs the order status, stop statuses, parcel statuses and charges.

Scenarios:
- **A.** P1, P2 → D1, D2 with parcels P1→D1, P1→D2, P2→D2.
  - Complete both pickups and arrive at D1.
  - An immediate fail is refused with the minutes-remaining message.
  - Move the arrival time back 11 minutes, then fail D1 with RECEIVER_UNAVAILABLE and a valid return distance (straight-line × 1.3).
  - Expect one return stop for P1 and one pending charge of 10 × distance + GST.
- **B.** A 100 km return distance, run inside a nested block, is refused with RETURN_DISTANCE_INVALID. It uses a second, similar order so the check actually runs.
- **C.** Deliver D2 normally.
  - Arrive at the return stop and enter the correct code while the charge is unpaid.
  - Expect payment_pending, with the stop's attempt count unchanged.
- **D.** Set a fake Razorpay order id on the charge and mark it paid twice (the second call changes nothing).
  - Entering the return code now succeeds.
  - Expect P1→D1 returned, the others delivered, and the order DELIVERED.
- **E.** A separate order with 2 pickups and 1 drop.
  - Both pickups fail after the wait (SENDER_UNAVAILABLE).
  - Expect the order CANCELLED with ALL_PICKUPS_FAILED and refund fields unchanged.

## Technical notes
- Settlement criteria are written once, in the tick, next to the existing all-pickups-failed loop.
- `courier_sweeper` itself is not touched.
