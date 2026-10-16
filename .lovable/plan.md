# One coupon sheet for Clean, Store and Food checkouts

## What the customer sees
Tapping "Apply coupon ›" on any checkout opens a bottom sheet (no page change; back closes it):

- **Top: code box.** "Enter coupon code" + Apply. A wrong code shows the reason under the box, in English or मराठी.
- **Available coupons.** Each card shows:
  - the code chip
  - a short description (or the title)
  - "Min order ₹___" when one is set
  - "You save ₹___" for this order
  - an Apply button
  Best savings come first.
- **Not available for this order.** These are greyed, without Apply, and show the reason, for example:
  - "Add ₹120 more to use this"
  - "Not valid for this service"
  - "Only on your first order"
  - "Already used"
  - "Expired"
- An applied coupon shows a tick and "Applied". Applying closes the sheet and the bill updates.
- Guests are asked to log in before the list loads.

## Behaviour per checkout
- **Clean / Wash:** savings are checked against the booking price, duration and service. This replaces today's full-page coupon picker.
- **Store / Food:** savings are checked against the item total. Coupons limited to cleaning services show as "Not valid for this service". Applying sets the coupon on the order, and the backend bill confirms the final discount as it does today.

## Technical details
- New DB function `app_checkout_coupons(_base_amount numeric, _duration_minutes int, _category_id uuid)` (authenticated, SECURITY DEFINER). It returns every coupon from `my_coupons()` plus coupons that would show but are ineligible: `{code, title, description, min_order_amount, discount, ok, reason}`. It evaluates each one with `coupon_quote_core`, so browsing the list does not count toward the 5-wrong-codes lock. Typed codes keep going through the existing validation, which keeps the lock.
- New `src/components/CouponSheet.tsx` (bilingual reason map, reused by both checkouts) with props `baseAmount`, `durationMinutes?`, `categoryId?`, `appliedCode`, `onApply(code) => Promise<boolean>`, `onClose`.
- Clean: `BookingSummaryScreen` opens the sheet in place of `setPhase("coupon-picker")`. Apply uses the existing `previewCoupon` to build the `AppliedCoupon`. `CouponPickerScreen.tsx` and the `coupon-picker` phase are removed.
- Store/Food: `CommerceCheckoutScreen` replaces its inline code box with the sheet. Apply sets the coupon code, and the existing quote reports the result.
