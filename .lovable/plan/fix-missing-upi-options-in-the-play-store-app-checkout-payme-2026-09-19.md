# Fix missing UPI options in the Play Store app checkout (payment stays inside the app)

## What's actually happening

On the website, Razorpay's checkout shows every UPI app (GPay, PhonePe, Paytm). Inside the Android app the same checkout hides them. This is not a key or dashboard problem: Razorpay hides "pay with UPI app" when its page runs inside an app's built-in browser, because that built-in browser is not allowed to hand the payment over to GPay/PhonePe.

## What you want

Payment must happen inside the badiyos app itself — no Chrome, no browser hop.

## The honest constraint

To open GPay/PhonePe/Paytm from inside the app, the app needs Razorpay's native Android payment sheet. That is a change in the app's native part, so it needs **one new APK build and a Play Store upload**. There is no way around this: the current APK simply does not contain the capability, and web-only changes cannot add it.

So the plan is: I prepare everything now, you do one build when you're ready. After that build, all future payment changes stay live-updating as usual.

## What gets built

1. **Native Razorpay payment sheet in the app.** Add Razorpay's official Capacitor plugin so, inside the app, tapping Pay opens the native payment sheet with all UPI apps, cards, netbanking and wallets. The user never leaves badiyos.
2. **Website unchanged.** On the website the existing in-page checkout keeps working exactly as today. One shared payment helper decides which one to use.
3. **Same treatment everywhere money is taken:** booking checkout, service extension top-ups, and tips on the live service screen.
4. **Server verification unchanged.** Amounts still come from the server, the payment is still verified server-side before a booking is created, and the existing webhook safety net still rescues any paid-but-unsaved booking. Coupons and GST logic are untouched.
5. **Build instructions.** I'll write down the exact steps and the native files/settings needed, so the person who builds the APK can follow them without guesswork.

## What you do

1. Approve this plan; I make all the code changes.
2. When ready, run the app build and upload the new APK to Play Store.
3. After that, UPI apps appear inside badiyos checkout on Android.

Until that build is uploaded, users on the current APK will keep seeing the reduced option list — nothing I change on the server or website can fix that for them.

## Technical notes

- Add `@capacitor-community/razorpay`; wrap it in a single `payWithRazorpay()` helper in `src/lib` that branches on the existing `isNativeShell()` check (`src/lib/nativeServerFn.ts`). Native path calls the plugin's `open` with the order id and key returned by `create-razorpay-order`; web path keeps the current `window.Razorpay` flow.
- Callers to migrate: `src/components/PaymentScreen.tsx`, and both the extension and tip flows in `src/components/tracking/ServiceInProgressScreen.tsx`.
- The plugin's success payload carries `razorpay_payment_id` / `razorpay_order_id` / `razorpay_signature` in the same shape the web handler already consumes, so downstream booking creation, coupon application and tip verification (`src/lib/tips.functions.ts`) need no change.
- Handle plugin cancel/error the same way the web `ondismiss` path is handled today, including the paid-but-unsaved recovery check.
- `capacitor.config.ts` stays as-is (live `server.url`); document the added plugin in `native/android/MANUAL_MERGE.md` alongside the existing manual steps.
