# Per-stop OTPs and rider stop actions (backend only)

No app screens change. Today's 1-pickup-1-drop flow keeps working through the existing functions, which now pass through to the new per-stop logic.

## Current state (checked)
- Courier orders: 4 COMPLETED, 1 CANCELLED, 1 REQUESTED. None are ARRIVED_PICKUP / PICKED_UP / IN_TRANSIT, so the safety pre-check should pass.
- Functions that touch the old order-level code table: courier_issue_otp, courier_verify_otp, courier_get_otp, courier_resend_otp, courier_refresh_otp, courier_update_contact, merchant_get_pickup_otp, courier_orders_log_event. The others named in the brief (courier_log_otp_send, courier_otp_owner_gate, store_get_delivery_otp) reach it only through these, and get re-checked while building.

## Steps (one migration)
0. Safety pre-check first: stop with "Active courier orders exist, run later" if any order has a live code.
1. `courier_issue_stop_otp(stop_id)`: per-stop code (pickup / delivery / return), only the hash stored, 12h expiry, attempts reset, issue time only moves forward. Server-only.
2. Legacy resolution helper: first unfinished pickup (or drop) stop by sequence, else the first one.
3. Rewrite every function listed above to use per-stop codes through that helper. Signatures, return shapes, send counts, cooldowns, attempt limits and contact-edit limits stay the same, now counted per stop. Nothing writes to the old table after this (the table is kept).
4. New rider functions, each checking the assigned rider, locking the order, setting the actor and logging to the event log with stop_id:
   - `courier_rider_arrive_stop` — next pending stop only, one arrived stop at a time; status rules as in the brief; issues the pickup code; sends the existing "Rider reached pickup" push.
   - `courier_verify_stop_otp` — 5 wrong tries lock that stop for 30 min and flag ops; pickup/drop success updates stop, parcels and order; moves to IN_TRANSIT automatically and issues drop codes once all pickups are done; ends DELIVERED, or FAILED_DELIVERY + ops flag when nothing was delivered; "Delivered at drop X of Y" for multi-stop.
   - `courier_update_stop_contact` — owner only, pending/arrived stop, same phone rule and limit; re-issues an existing code; keeps the flat first-pickup/first-drop contact fields in sync.
5. Legacy wrappers: courier_rider_advance (ARRIVED_PICKUP → arrive on resolved pickup; IN_TRANSIT idempotent when already in transit) and courier_verify_otp (delivery marks the drop arrived first).
6. Untouched: rider cancel, customer cancel, settle, dispatch/offers, incident report. Confirm rider cancel is still blocked from PICKED_UP on.
7. Access: the three new rider/customer functions for signed-in users; issue and helper functions for the server only.

## Behaviour change to know about
For 1-pickup-1-drop orders the delivery code is now created right after the pickup code is verified, not when the rider taps "Start trip".

## Checks after applying
- Confirm the pre-check passed and no function still writes the old table (definition search).
- List every function created or changed.
- A live run needs execute rights the read-only role lacks; if unavailable, the end-to-end flow is reported as unconfirmed.
