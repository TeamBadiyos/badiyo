# What the screenshot shows, and what to do next

## The issue

The payment on screen (`pay_TaFHSWAAMUwtjZ`, "Demo 1min", Rs 1) failed at 07:06 UTC today. The saved failure reason in the database for exactly this payment is "Invalid service duration".

Cause: before saving a booking, the system looked up the price only in the old duration-based price table, which contains just 60, 120 and 180 minutes. The "Demo 1min" service is priced in the newer service list (1 minute, Rs 1), so every booking of it was rejected — both when the app saved it and when the automatic payment-recovery ran afterwards. That is why retry kept failing.

This price lookup was already corrected minutes after this failure: it now falls back to the service list (by service name, then by duration). The screenshot is from a payment made before that correction, so its money is still paid with no booking.

## What still needs doing

1. Recover this one stuck payment: the saved payment record for `order_TaFGawLJDTpu99` is parked as "needs staff attention" with 6 failed attempts, so nothing will retry it on its own. Reset it back to pending and run the recovery so the booking is finally created for the customer, then confirm the booking exists and is linked to the payment.
2. Re-check the older stuck paid payments in the same state and recover any that are genuine bookings, so no other customer is left charged without a booking.
3. Verify end-to-end with a fresh Rs 1 "Demo 1min" purchase in the app: payment succeeds, booking saves on the first try, and the app moves straight into tracking with no red error box.
4. If anything still fails, capture the exact new error from the payment record rather than guessing.

## Technical notes

- Failure evidence: `payment_intents` row `order_TaFGawLJDTpu99` (status `needs_staff_attention`, attempts 6, `last_error` = "Invalid service duration"), plus matching `audit_logs` entries at 07:06:27-07:06:30 carrying `pay_TaFHSWAAMUwtjZ`.
- The price lookup lives in the `bookings_before_insert` trigger; it now tries `service_catalogue_config`, then `service_price_options` matched by label, then by `duration_minutes`.
- Recovery step: reset `status` to `pending` and `attempts` to 0 for the affected order, then invoke `system_fulfill_payment_intent(_order_id, _payment_id)`; confirm a `bookings` row appears with `razorpay_payment_id = pay_TaFHSWAAMUwtjZ` and `price = 1`.
- No app-code changes are expected for this; it is data recovery plus verification.
