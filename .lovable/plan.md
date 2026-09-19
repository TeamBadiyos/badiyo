# Fix missing UPI options in the Play Store app checkout

## What's actually happening

On the website, Razorpay's checkout shows every UPI app (GPay, PhonePe, Paytm). Inside the Android app the same checkout hides them. This is not a key or config problem — Razorpay deliberately hides "pay with UPI app" when the page runs inside an app's built-in browser, because that built-in browser is not allowed to hand the payment over to GPay/PhonePe.

So the options are missing for the same reason on any app built this way, and no change to the payment keys or the Razorpay dashboard will bring them back.

## The fix, without a new APK

You said a new Play Store build isn't possible right now. Good news: the app already ships with the ability to open a real Chrome window (Chrome Custom Tab). Chrome *can* hand payments to UPI apps. So instead of adding anything native, we move checkout into that Chrome window for app users only.

Flow for app users:

```text
Booking summary -> Pay
   -> app opens Razorpay checkout in a real Chrome window
   -> all UPI apps appear; user pays in GPay/PhonePe/Paytm
   -> Chrome returns to a badiyos payment-result page
   -> app closes Chrome, confirms the payment with our server,
      creates the booking, and goes to tracking as usual
```

Website users see no change at all — the current in-page checkout stays.

## What gets built

1. **A hosted checkout page** on badiyos.com that opens Razorpay for one specific order and, when payment finishes, sends the result back to the app's return address.
2. **App-side switch**: when running inside the Play Store app, the Pay button opens that page in the Chrome window instead of the in-app checkout. Website keeps the existing behaviour.
3. **Return handling**: after Chrome closes, the app verifies the payment with our server (never trusting anything the page sends back), then continues to the existing booking-creation and tracking flow, including the coupon and payment-recovery logic already in place.
4. **Safety net**: if the user closes Chrome without paying, or the network drops, the app checks the order status with our server and either resumes tracking (payment went through) or returns them to the summary to retry. The existing Razorpay webhook already rescues any paid-but-unsaved booking.
5. **Same treatment for the two other payment points**: service extension top-ups and tips on the live service screen.

## What this does not cover

Even in Chrome, a handful of banks' UPI flows can behave differently from a fully native payment sheet. If after this you still want the most seamless experience (Razorpay's native Android payment sheet, which also removes the Chrome hop), that genuinely needs one new APK build. I can prepare that change too and keep it dormant until you're ready to build — say the word.

## Technical notes

- Detect the app shell with the existing `isNativeShell()` helper in `src/lib/nativeServerFn.ts`; keep the current `window.Razorpay` path for web.
- New public route (e.g. `src/routes/api/public/...` plus a thin page route) renders Razorpay Checkout for a given `order_id`, and on success/failure redirects to a return URL on `user.badiyos.com` that the app intercepts.
- Open with `@capacitor/browser` (already a dependency, so it is present in the live APK) and close it on return; listen for `browserFinished` to handle user-cancelled payments.
- Verification stays server-side: reuse the signature/`payment_id` verification path already used by tips (`src/lib/tips.functions.ts`) rather than trusting redirect params.
- No change to key handling, GST, coupon reservation, or `create-razorpay-order` pricing logic.
