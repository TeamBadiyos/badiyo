# Checkout coupon selection redesign

## Goal
Replace the coupon-code box on the booking summary with the selected “Modern utility mobile” experience. Customers can see available coupons, open a dedicated picker, apply the best suitable offer, and immediately see the exact discount and updated bill.

## Customer experience
- Show a compact coupon area on Booking Summary:
  - Before selection: “View all coupons” with the number of available offers.
  - After selection: green confirmation, exact savings amount, coupon code/title, and a Change action.
  - Keep Remove available without hiding it behind unclear gestures.
- Open a full-screen Coupons picker within the current booking flow:
  - Back button and clear “Coupons” title.
  - Manual coupon-code field with Apply.
  - “Applicable coupons” section with the saving each coupon gives for this booking and an Apply action.
  - “More coupons” section for offers that currently fail eligibility, showing the friendly reason such as minimum booking value.
  - Loading, no-offers, request-error, and invalid-code states.
- Applying a coupon returns to Booking Summary and updates discount, taxable value, GST, round-off, total, and the fixed payment bar immediately.
- No Amazon Pay, payment-partner advertising, or unrelated promotional banner will be added.

## Visual direction
- Match the selected modern utility layout: clean full-width rows, restrained borders, green success state, dashed separator, concise hierarchy, and touch-friendly controls.
- Preserve Badiyos’ existing green palette, Nunito Sans typography, safe-area spacing, and current card styling rather than importing the prototype’s external font or colors.
- Keep the design mobile-first and prevent text or action overlap for long coupon titles and Marathi labels.

## Implementation
- Add `coupon-picker` to the existing booking phases and wire back/apply navigation without creating a separate website route.
- Extend the coupon list helper to evaluate every available coupon against the current service using the existing secure coupon preview operation. Coupon eligibility and discount remain server-verified.
- Create a focused coupon-picker screen and reuse the existing coupon types/value formatting.
- Simplify `BookingSummaryScreen` by removing its inline code-entry state and exposing an “open coupons” callback.
- Add matching English and Marathi coupon copy.
- Preserve the existing payment, coupon reservation, tax, and ₹1 round-off logic.

## Validation
- Type-check the affected code.
- Verify on the running mobile booking flow that the picker opens and closes correctly, manual and listed coupon application work, unavailable offers explain why, and all bill values refresh correctly.
