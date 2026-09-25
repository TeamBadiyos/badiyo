# Business trips: bulk riders, return charges, status sync, OTP view (backend only)

Only parcel orders created for businesses change. Customer parcel orders and store deliveries stay as they are today.

## 1. Bulk Delivery skill
- Add a hidden, active "Bulk Delivery" category, set up like the existing "Courier Delivery" skill category. Riders request it, and ops approve it in Skill Approvals.
- Add `courier_orders.required_skill_id`. `courier_create_business_order` fills it in.
- `courier_eligible_riders`: when that field is set, a rider also needs the approved skill. Orders without it are unchanged.
- The offer goes to every eligible bulk rider at once. First accept wins, and the other offers are cancelled.
- Check `courier_offer_respond` for a row lock and a conditional update. Fix it only if two riders could both win, and report what I found.

## 2. Return charge from the wallet
- `courier_rider_fail_stop`, business orders only:
  - Uses `return_per_km` from the plan snapshot saved on the batch.
  - Debits the wallet via `business_wallet_post(... 'return:'||charge_id, allow_negative)`.
  - Marks the charge paid straight away.
  - Pushes to the business instead of the customer: "Delivery failed at <receiver>, parcel returning. ₹X charged."
- Finalize already blocks new batches while the balance is negative.

## 3. Status sync to business orders
- A trigger on parcel and order status updates every order in a merged drop:
  - picked: in_transit
  - delivered: delivered, with delivered_at
  - returned: returned
- Cancelled because all pickups failed: orders become failed, with the reason. No refund.
- Cancelled before pickup (ops or any other path):
  - Orders go back to pending.
  - The batch fare is refunded once via credit 'refund:'||order_id.
- Every cancel path will be listed and reported.
- New `business_requeue_order(_order_id, _actor_label)`: makes a fresh pending copy of a failed or returned order and links it to the old one. This needs a new `requeued_from_id` column.

## 4. Business OTP view
- New `business_get_trip_otps(_courier_order_id)`, for the owning business only (guarded by `business_require_delivery`).
- Returns the pickup code and each drop's code once it is issued, plus receiver name, phone, reference numbers and stop status.
- A code is hidden once its stop is done, the same rule as `courier_get_order_otps`.

## 5. Notifications
- Check every courier push path: stop codes, status updates, offers and payments.
- For business orders, send to the Merchant App if it has a push setup; otherwise skip Customer App pushes. Report the result.

## Technical details
- One migration.
- Before writing it, read the live definitions: `courier_eligible_riders`, `courier_offer_respond`, `courier_rider_fail_stop`, `courier_cancel_order`, staff cancel functions, the push sender, `partner_skills`/`service_categories`, and the batch fare snapshot.
- Re-check `courier_offer_respond` and every cancel path after the change.
- Type check if app code changes (only if a push path is in server code).
- Final reply lists everything created or changed.
