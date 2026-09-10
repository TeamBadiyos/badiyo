# Live Service Screen — Snabbit-style redesign

Rebuild the "service in progress" screen into a single rich page, and add a floating
"Service Ending Soon" bar that follows the customer everywhere in the app.

## 1. Countdown card (top)

- Circular progress ring with the remaining time in the middle, plus "Ends at 1:08 PM".
- Colour changes with time left:
  - more than 15 min — brand green
  - 15 min or less — yellow/amber
  - 5 min or less — red
- Big "Extend Service" button below the ring (uses the existing extension + payment flow).

## 2. Check-out OTP card

- Shows the 4-digit end code in tiles.
- New row: "Booked for someone else? — Share OTP" with a WhatsApp icon.
  Tapping it opens WhatsApp (wa.me link) with this message pre-filled:

```text
Hi 👋

Your service is currently in progress.

🔹 *Expert Name:* {expert name}

🔹 *Duration:* {duration} min

🔹 *Started at:* {start date/time}

⏱️ Your job ends at {end date/time}.

⏱️ Once done, please share this *Check-Out OTP* to end the service: *{otp}*

Thank you for choosing badiyos!
```

- "End Service" / completion-code button stays as today.

## 3. Refer & Earn banner

- Banner block under the OTP card: image on the right, headline, sub-line, "Refer now" button.
- Content comes from the command center, not code: a new `homepage_sections` row of type
  `inprogress_banner` holding image URL, title, subtitle, button label and action.
  If no row is active, no banner shows.

## 4. Expert card

- Photo, name, star rating (average of past ratings for that expert), and a call button.
- Falls back to an avatar icon when there is no photo, and hides the rating when the
  expert has no reviews yet.

## 5. Tip the expert

- "Make their day with a tip — 100% of the tip goes to the expert".
- Three amount chips: ₹25, ₹50 (marked Popular), ₹100.
- Paid online through Razorpay. On successful payment the amount is credited to the
  expert's wallet and recorded against the booking; the card then shows a thank-you state.

## 6. Booking details footer

- Duration line ("60 min visit") and the service address, matching the reference layout.

## 7. Floating "Service Ending Soon" bar (all screens)

- While a booking is in progress, a slim dark bar sits above the bottom navigation on
  every screen: mini timer ring, "Service Ending Soon", "Ends at 1:08 PM", and an
  "Extend" button that jumps to the live service screen.
- Same colour rules as the main timer (green / yellow under 15 min / red under 5 min).
- Purely additive — it does not block taps or change any existing screen behaviour, and
  it disappears when the service ends or is cancelled.

## Technical notes

- New DB work (one migration):
  - `booking_tips` table (booking, expert, amount, payment id, status) with RLS so a
    customer only sees their own tips, plus an RPC that verifies the Razorpay payment,
    inserts the tip and credits `wallet_ledger` for the expert.
  - RPC returning an expert's public profile with average rating and review count for a
    booking (extends `get_assigned_expert_public`).
  - Seed an inactive `inprogress_banner` row in `homepage_sections` as a template.
- `create-razorpay-order` gains `purpose: "tip"` with a server-side whitelist of allowed
  tip amounts (25/50/100), so the client cannot dictate the charge.
- New `useActiveBooking()` hook (single cached query + realtime) feeding the global bar;
  mounted once in `src/routes/index.tsx` so no screen needs changes.
- `ServiceInProgressScreen.tsx` is restructured into small cards; the existing timing
  query, realtime subscription, extension sheet and completion-code flow are reused.
- New translation keys added to both English and Marathi.
