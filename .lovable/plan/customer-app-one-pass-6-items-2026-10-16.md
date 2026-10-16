# Customer App — one pass (6 items)

Everything this needs on the server already exists: the `customer_note` and `refund_destination` booking fields, and `app_create_booking_wallet`, `app_cancellation_policy`, `app_cancel_quote` and `app_cancel_booking`. The work is in the app only. Nothing in the database changes.

## 1. Note for expert is saved
- Checkout trims the note to 300 characters, with a counter. It goes as `customer_note` both in the normal booking/payment path and in the wallet payload.

## 2. Pay fully with wallet
- When wallet balance ≥ total, Pay calls `app_create_booking_wallet` (no Razorpay) and opens "Finding your expert" for the new booking.
- Partial wallet stays as it is today.

## 3. Cancellation policy sheet
- "Cancellation policy ›" on Checkout and in Booking details opens one shared sheet. It loads `app_cancellation_policy(service_key, city_id)` and shows `lines_mr` in Marathi (falling back to English), otherwise `lines_en`.
- This replaces the placeholder policy text I wrote earlier.

## 4. Cancel with refund choice (Booking details)
- Step 1: `app_cancel_quote` → "You'll get back ₹X — Y% fee", or "Full refund" / "No refund".
- Step 2 (only when the refund is above ₹0): "Where should we send ₹X?"
  - badiyos Wallet — instant, use on your next booking (can't be withdrawn to bank)
  - Original payment method — 5–7 working days (default)
- Confirm → `app_cancel_booking(id, 'wallet' | 'original')`.
- Booking details shows "Refund to: Wallet / Original payment method" from `refund_destination`. Wallet history labels refund entries "Booking refund · #number".
- Both languages.

## 5. Location denied on first open
- On the first-open permission screen, if location is refused, show the same "Open settings" / "Enter address manually" screen. Enter manually → continue into the app.

## 6. Marathi
- Every visible line on the Referral, Rewards and Help screens gets English + Marathi text.

## Technical notes
- New `src/lib/cancellation.ts` (policy, quote and cancel RPC wrappers) and a `CancellationPolicySheet` component.
- `CancelBookingButton` switches from the old server-function refund to the RPC flow. Training/zero-amount bookings show "No refund".
- `getCurrentCoords` gets a denied check in FirstOpenScreen.
- Not tested with a real payment or on a phone: sign-in testing isn't available in the preview for this backend.
