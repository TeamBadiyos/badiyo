# Expire unpaid store orders

## Current state (checked)
- Order BS26092453356: online, status pending, payment pending, no Razorpay order attached, created 12:44 UTC. It is the only unpaid store order right now.
- The store sweeper only auto-rejects paid orders the shop didn't accept. Nothing expires unpaid ones.
- If a payment arrives for an order that is no longer pending, it is already refunded ("late_payment"), but no admin alert is sent.

## Changes
1. **Auto-expire (sweeper):** new setting `store_unpaid_expiry_minutes` (default 10). Each sweeper run cancels online orders still `pending` with payment `pending` older than that: status `cancelled`, cancel_reason `PAYMENT_NOT_COMPLETED`, cancelled_at set, audit entry. No refund, no stock change.
2. **Reuse on retry:** `store_create_order` first looks for the customer's own pending, unpaid, non-expired order at the same shop with the same items and quantities. If found, it refreshes address/delivery fee/total and returns that order (flag `reused: true`) instead of creating a new one. Checkout then creates a fresh Razorpay payment for it (attach overwrites the old Razorpay order id). If the cart changed, the old pending order is cancelled (`PAYMENT_NOT_COMPLETED`) and a new one is made.
3. **Webhook after expiry:** in `system_store_mark_paid`, if the order is cancelled/expired: record the payment, never place it, queue a full refund (reason `payment_after_expiry`), and send an admin alert (existing alert queue) plus an audit entry. Store-side stock untouched.
4. **Checkout safety:** before opening Razorpay, `store_attach_payment` refuses orders that have expired, so the app shows "Order expired, please try again" and a new order is created.
5. **BS26092453356:** after the migration, run the sweeper once and confirm by query that it is `cancelled` / `PAYMENT_NOT_COMPLETED`.

## Test (temporary, rolled back)
Create order → retry with same cart returns same id → age it 11 min → sweeper cancels it, stock unchanged → simulated webhook for it → not placed, refund queued, admin alert queued.

## Technical details
- One migration: `store_setting` default, updated `store_sweeper`, `store_create_order`, `store_attach_payment`, `system_store_mark_paid`.
- Small app change: map new error code `order_expired` in StoreCartScreen to an EN/MR message.
