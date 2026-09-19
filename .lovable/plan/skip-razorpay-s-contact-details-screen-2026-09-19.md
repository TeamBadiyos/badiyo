# Skip Razorpay's "Contact details" screen

## What is happening

Razorpay only shows that mobile-number screen when the app opens checkout without the customer's contact details. The parcel booking does not send any customer details at all, so Razorpay asks for the number every time. The service booking, extension and tip flows do send a number, but it is taken straight from the login record and can be in a format Razorpay does not accept as complete (missing country code, or empty for email-only accounts) — in that case the same screen appears.

## The fix

1. **Always send the customer's details to Razorpay.** Before opening payment, use the signed-in customer's name, mobile and email (email only if the customer has one). The number is normalised to `+91XXXXXXXXXX`, which is what Razorpay needs to treat the contact step as complete.

2. **Parcel booking gets the same details.** It currently sends none; it will send the signed-in customer's name and mobile (falling back to the pickup contact number already typed in the flow).

3. **One shared source of truth.** A single small helper builds these details from the logged-in profile, so booking, parcel, extension top-up and tip all behave identically and nothing can drift again.

4. Payment then opens directly on the payment methods screen (UPI apps, cards, netbanking) with no details step in between, on both the app and the website.

## Not changing

Amounts, GST, coupons, order creation, signature verification and all server-side payment logic stay exactly as they are — this only fills in the customer details passed to the payment sheet.

## Technical notes

- New `src/lib/paymentPrefill.ts`: reads `users.full_name`, `users.phone` (falling back to the auth user phone), and `auth.user.email`; returns `{ name, contact, email }` with contact formatted as `+91` + last 10 digits, omitting any field that is empty.
- `src/lib/razorpayCheckout.ts`: pass `prefill.name` too (currently only contact/email), and drop empty-string fields so Razorpay does not treat `""` as "ask the user".
- Call sites updated: `src/components/PaymentScreen.tsx`, `src/components/courier/CourierBookingScreen.tsx`, `src/components/tracking/ServiceInProgressScreen.tsx` (extension + tip).
- Verification: typecheck, production build, and a web checkout open to confirm the sheet lands on payment methods instead of contact details.
