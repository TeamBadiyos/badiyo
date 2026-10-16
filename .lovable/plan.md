# Booking page fixes (Maid / Car & Bike Wash)

## 1. Wash uses its own hours and capacity
**Cause found:** the booking page also asks the older per-slot check (`service_slot_allowed`) for every time. That check rejects any time before a city-wide "first slot hour" (10 AM), whatever the service — so Wash 9:00 / 9:30 come back as not allowed and the page shows them as "Full". The checkout also re-checks with Clean Home's key (`"clean"`) for Book Now, instant hours and fully-booked slots, even for Wash.

Changes:
- Booking page: times, "Now", opening time and Full state come only from `app_service_hours(key)`, `app_book_now_allowed(key)` and `app_fully_booked_slots(key)`. Drop the per-slot `service_slot_allowed` loop (it is the one causing the false "Full").
- Checkout (final check before Razorpay): pass the service key (`clean` / `wash`) from the booking page and use `app_book_now_allowed(key)` for Now and `app_fully_booked_slots(key)` for scheduled slots, instead of the hardcoded `"clean"` calls.
- Audit every other hours/capacity/Book Now read on these two screens so each uses the selected service's key.
- Verify against the live database that a 9:00 AM Wash booking is also accepted when the booking is saved (server-side slot rules). If the server still rejects it because of the city-wide 10 AM rule, I'll report it — that rule lives in the backend and needs a Command Center / database change.

## 2. Page title
Title = the service's card title from `app_service_content` in the app language (e.g. "Car & Bike Wash" / "Home Maid"); falls back to Maid / Car & Bike Wash text, never "Book".

## 3. One selected style
Vehicle/duration cards, day cards and time chips all use: green border + light green background + bold dark text. Remove the solid green fill on the selected time.

## 4. Sideways-scroll hint
Morning / Afternoon / Evening rows and the day row: chips sized so the last visible one is partly cut, plus a soft white fade with a small "›" on the right edge while more remains; it hides when scrolled to the end (or when everything fits).

## Test
Phone-size preview: open Wash booking → 9:00 and 9:30 shown as available (unless really full), title "Car & Bike Wash", selected styles match, arrow shows and hides on scroll. Repeat for Maid (10 AM start).

## Technical details
- `CleanScheduleScreen.tsx`: remove `dayAllowed` query; `isFull` = `fullSlots` only; `loaded` waits on `fullSlots`; new `title` prop from CleanTab (`pick(lang, content.hero.card_title, …)`); time chip active class `border-primary bg-primary/5 text-foreground font-extrabold`; new `ScrollRow` wrapper (ref + scroll listener → right fade/› visibility), chip widths tuned so ~3.5 fit.
- `CleanTab.tsx`: pass `serviceKey` through `onCheckout` slot data to the checkout.
- `PaymentScreen.tsx`: replace `service_instant_allowed`/`instant_booking_enabled`/`list_fully_booked_slots` with `"clean"` → `app_book_now_allowed` / `app_fully_booked_slots` using the passed key (default `clean`), keeping the same messages.
