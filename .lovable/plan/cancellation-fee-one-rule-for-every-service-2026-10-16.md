# Cancellation fee: one rule for every service

## The rule
The fee is worked out on the **whole amount paid** (wallet + online). It is taken **first from the wallet part, then from the online part**. Whatever is left is refunded: wallet part back to the badiyos Wallet instantly, online part through the normal Razorpay refund.

Within the wallet part, the fee uses bonus money first, then cash, so customers keep withdrawable-style cash where possible.

## Example: paid ₹60 (wallet ₹40 + online ₹20), fee ₹30
```text
Fee ₹30  -> taken from wallet ₹30, online ₹0
Wallet   -> ₹40 - ₹30 = ₹10 back to badiyos Wallet (instant)
Online   -> ₹20 - ₹0  = ₹20 refunded to UPI/card (Razorpay, 5-7 working days)
Total refunded ₹30, kept ₹30
```
If the customer picks "badiyos Wallet" as the refund destination (Clean), the ₹20 online part also goes to the wallet instead.

## What is wrong today
- **Parcel:** the fee is calculated only on the online part, and any wallet money is returned in full on every cancel. For ₹60 (₹40 + ₹20) with a 50% fee today: fee ₹10 from online, ₹40 back to wallet — the customer loses only ₹10 instead of ₹30.
- **Clean:** the fee is on the whole amount, but it is split in proportion. For the example: fee ₹30 = ₹20 from wallet + ₹10 from online; refund ₹20 to wallet + ₹10 online. Total is right, the split is not.
- **Store / Food:** there is no cancellation fee at all — cancelled, rejected or refunded shop orders always return the full wallet part and the full online part. Already follows the rule (fee ₹0); no change.

## Changes
1. **Parcel fee** — work out the fee on online + wallet paid. Customer cancel takes it from the wallet first, then online; posts the wallet refund straight away; sends only the online remainder to the Razorpay refund. Rider share of the fee is unchanged.
2. **Parcel automatic wallet return** — keep the full wallet return for cancels with no fee (rider failed, expired, admin cancel), but skip it when a fee was already settled, so the wallet is never refunded twice.
3. **Clean refund split** — fee taken from wallet bonus, then wallet cash, then online; refund lines (wallet / online) follow. The cancel screen's "You'll get back ₹___" already reads these numbers, so it updates by itself.
4. **Check** — run the ₹60 / ₹40 / ₹20 / ₹30 example against the new Parcel and Clean calculations (read-only math check) and report the numbers.

## Technical details
- `courier_cancel_fee_for`: `_total := total_amount + wallet_amount`; fee on `_total - gst_amount`; also return `fee_from_wallet = least(fee, wallet_amount)`, `refund_wallet`, `refund_online = greatest(total_amount - (fee - fee_from_wallet), 0)`; `refund_amount` = online refund (callers `business_get_trip_otps`, `business_reject_trip_internal` keep working; business orders have no wallet so values are unchanged).
- `courier_cancel_order`: post `refund_wallet` via `wallet_post(... 'refund_in','bonus'/'cash' ...)` (bonus first for fee), pass `refund_online` to `courier_mark_refund_pending`; push text shows both parts.
- `courier_wallet_return_on_end` trigger: skip when `NEW.cancellation_fee > 0`.
- `booking_refund_split`: replace proportional `_r` split with ordered deduction (bonus → cash → online); output keys unchanged so `booking_cancel_core` and `app_cancel_quote` need no edits.
- All via `CREATE OR REPLACE`, no table changes.
