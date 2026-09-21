# Fix: 100% discount (₹0) orders stay stuck

## What is happening

The last free order (`#a07f88`, ₹289 discount, total ₹0) was created in the customer app with status `confirmed`, but:

- no expert was assigned (`assigned_expert_id` is empty),
- the Command Center shows it under "Awaiting payment",
- the customer sees an order that never progresses.

Two earlier ₹0 orders ended up `rejected` the same way.

## Why

When the bill is ₹0 the app skips the payment gateway, so there is no payment reference saved on the order. Everything downstream treats "no payment reference" as "customer has not paid yet":

- the automatic dispatch rule explicitly stops when the payment reference is empty, so the order is never sent to experts and never moves to `accepted`;
- the Command Center board puts orders without a payment reference in the "Awaiting payment" column.

So a fully discounted order is technically paid (₹0 due) but looks unpaid everywhere.

## The fix

Treat a ₹0 coupon-covered order as a completed payment.

1. Save a clear internal payment reference on free orders (the same `free_...` id already issued when the order is created), so every screen and rule sees the order as paid.
2. Allow automatic dispatch for orders with nothing to pay: dispatch when a real payment reference exists **or** the order total is ₹0 with a `free_...` reference. The order then moves out of "Awaiting payment" and goes to nearby experts exactly like a paid order.
3. Backfill the three existing ₹0 orders: mark the current pending one as paid and dispatch it; leave the two already-rejected ones as they are.
4. Protect the refund path: a cancelled ₹0 order must never be sent to the payment gateway for a refund (nothing was charged). Refund attempts skip `free_...` references and record refund amount ₹0.
5. Expert payout on a ₹0 order stays as it is today (the expert still receives the locked payout share) — the completion payout fix from earlier already covers this.

## Rest of the order flow (checked, no change needed)

- Booking creation, price/GST locking and coupon redemption already work for ₹0 bills.
- Expert payout crediting on completion (expert OTP, staff OTP, Command Center) is already fixed and idempotent.
- The orders list already refreshes live on status change.

## Technical notes

- `src/components/PaymentScreen.tsx`: the free branch calls `createBooking(null, rzpOrderId)`; pass the `free_...` id as the payment id so `razorpay_payment_id` is stored.
- Migration updating `public.bookings_auto_dispatch()`: replace the hard `razorpay_payment_id IS NULL → RETURN NULL` guard with "payment id present OR (`total_amount` = 0 AND `razorpay_order_id` LIKE 'free\_%')", and audit-log the free dispatch as such.
- Data fix via SQL for booking `a07f8835-b1b3-4047-83de-71852b2cf566`: set the free payment id, which re-triggers dispatch.
- `src/routes/api/public/courier/process-refunds.ts` and the booking cancellation refund path: skip gateway refunds when the payment reference starts with `free_`.
