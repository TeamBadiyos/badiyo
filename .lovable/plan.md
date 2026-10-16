# Final Clean + shared Checkout

## Skipped (already done earlier)
- A1: Wash already uses only its own hours, full slots and "Now" (9:00/9:30 checked open). The booking title already comes from Command Center. The selected style is already the same everywhere, and the sideways-scroll hints already exist. I'll only re-check this in the preview.
- A4: The splash screen already shows status, banner and photos from the phone's saved copy. I can't check it in the installed Android app from here. You'll need to check it on a phone.

## A. Clean leftovers
- A2 Details sheet: the photo becomes 16:10, centred. The included / not-included lists already follow the app language (fixed last turn). I'll check they come back for both Clean and Wash cards.
- A3 Messages: small messages move to the bottom, just above the tab bar. Important alerts (payment failed, slot just filled, booking confirmed) slide in from the top.

## B. New shared Checkout (Clean now)
Top to bottom:
1. Compact address line with "Change", which opens the address sheet over Checkout.
2. One "What you're booking" card: photo, "Home Maid · 2 Hours" or "Car Wash · Bike", "Sat 17 Oct · 10:00 AM" or "Now", and "Edit" back to Booking with the same choices kept.
3. "You save ₹X on this booking" (original price minus price). Hidden when there is no saving.
4. One card: "Apply coupon ›" (once applied: "CODE · −₹50 Remove") and a "Use badiyos Wallet (₹balance)" switch.
5. "Note for expert (optional)" box, plus the service note from Command Center. Maid: supplies. Wash: water, plug point, vehicle parked, we won't drive.
6. Bill: price, GST from the server price check, round off, coupon, wallet, Total, then "Cancellation policy ›" (opens a sheet).
7. Bottom bar: total and "Pay ₹X". If the wallet covers everything: "Pay with wallet".
8. Guests can reach Checkout. Login (OTP) is asked only when they tap Pay, then they come back to the same Checkout. If the slot fills meanwhile, a message shows and they go back to Booking with their choices kept.
9. The word "coins" is replaced by "badiyos Wallet" in every customer-facing screen (Checkout, Wallet, Rewards, Referral, Help, Notifications, Profile, Home). All new Checkout text will be in both English and Marathi.

The existing booking and payment steps behind Pay stay exactly the same; only the screen changes.

## C. The "unsure" items
- Google sign-in icon and code: delete (nothing uses them).
- Old offers list: delete (Rewards → Coupons doesn't use it).
- "Sell on badiyos" card: delete the unused card. Profile → "Partner with badiyos" already exists and stays.
- Location-denied screen: keep it and show it when location permission is denied, with "Enter address manually" and "Open settings".
- Address-lookup helper: the address form and sheet don't use it, so delete it.

## Technical details
- Rewrite `BookingSummaryScreen.tsx` as a reusable `CheckoutScreen` taking a generic "line item" (photo, title, when, price, original price, service note), so Store/Food/Parcel can plug in later.
- The note for the expert is sent to the existing booking creation if it already accepts a note. Otherwise it is held in the app until a backend field exists, and I will report that.
- Guest gate: move `ensureSignedIn()` from Booking Continue to the Pay button. Before payment, re-check the slot with the existing slot / book-now checks. If it's full, show a toast and return to the Clean booking page with its saved selections.
- Toasts: `<Toaster position="bottom-center" offset=above tab bar>`, plus a top-position helper for important alerts.
- Location denied: show `LocationDeniedScreen` when `nativeGeolocation` reports a denied permission in the add-address map and the first-open flow.
- Copy changes are display text only; wallet amounts and logic stay the same.
