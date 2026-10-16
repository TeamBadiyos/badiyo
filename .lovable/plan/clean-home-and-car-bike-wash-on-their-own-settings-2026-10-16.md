# Clean Home and Car & Bike Wash on their own settings

Clean Home uses `clean` and Car & Bike Wash uses `wash` everywhere. All calls send the customer's city and work without login.

I checked the live data. Clean is open 10–7 and Wash 9–7, both wait 120 minutes. The quote returns 5% for Clean (₹149 → ₹156) and 18% for Wash (₹249 → ₹294).

## What changes for the customer
- **Hours, open/closed and holidays** for each service come from its own settings. The "Closed now · Opens …" line and the time ranges follow them.
- **Instant sheet**: Book Now follows its own setting.
  - `closed` → "We're closed now · Opens …"
  - `slot_full` → "All experts are busy right now"
  - `book_now_off` → "Book Now is off right now"
  - Each shows [Schedule] and [Notify me]. Notify me saves for the right service.
- **Schedule page**: full slots for the 7 days come from that service's own list.
- **Finding your expert**: the waiting time comes from that service's auto-cancel minutes.
- **Checkout bill**: price, GST % and GST amount come exactly from the booking quote. Pay ₹ uses its total (Clean 5%, Wash 18%), with coupon and coins applied the same way as today.

## Needed so the payment matches the bill
Today the payment server charges one flat 5% for every booking. It will read the same booking quote, so the amount charged matches the bill. Booking and payment otherwise work exactly as before.

## Technical details
- New `src/lib/serviceSettings.ts`: hooks for `app_service_hours`, `app_book_now_allowed`, `app_auto_cancel_minutes`, `app_fully_booked_slots`, and `app_booking_quote`, all keyed by (service_key, city_id). `serviceKeyFor(option)` returns `wash` for auto/wash categories and `clean` otherwise.
- `CleanBookSheet` and `CleanScheduleScreen` take a `serviceKey` prop. CleanTab passes `wash` when `draft.auto`. Replace `useServiceState("clean")`, `service_instant_allowed`, `instant_booking_enabled` and `list_fully_booked_slots` here. The per-duration end-before-close check stays local.
- `BookingSummaryScreen` and `PaymentScreen` (Clean bookings) use the quote's gst_rate, gst_amount and total instead of `useGstPercent`. Coupon and coins are still subtracted on top, as today.
- `create-razorpay-order` (booking branch): call `app_booking_quote` for the GST rate, falling back to the current flat rate on error. The booking insert's GST also needs to match: check `bookings_before_insert`/`booking_gst_percent` and line it up if it differs.
- The "Finding your expert" screen reads `app_auto_cancel_minutes` with the booking's service key.
- Verify: typecheck, plus a guest browser run of the Wash and Clean sheets. Compare a quote against the payment amount for one Wash and one Clean option, with no real payment.
