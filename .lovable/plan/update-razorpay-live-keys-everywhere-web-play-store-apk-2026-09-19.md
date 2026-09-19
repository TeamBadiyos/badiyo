# Update Razorpay live keys everywhere (web + Play Store APK)

The app and the live APK both load from https://user.badiyos.com, so one update covers web and the Play Store app — no new APK build is needed.

## What changes

1. **Collect the new credentials securely** (you paste them into Lovable's secure secret forms — never in chat):
   - `RAZORPAY_KEY_ID` — live Key ID from Razorpay Dashboard → Settings → API Keys
   - `RAZORPAY_KEY_SECRET` — live Key Secret from the same page
   - `RAZORPAY_WEBHOOK_SECRET` — the secret you set when creating the webhook in Razorpay Dashboard → Webhooks

2. **Update the secrets** so every payment path uses the new keys:
   - Order creation (bookings, extensions, tips) — reads `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
   - Payment webhook at `https://user.badiyos.com/api/public/webhooks/razorpay` — verifies signatures with `RAZORPAY_WEBHOOK_SECRET`
   - The checkout screen automatically picks up the new Key ID from the order response — no app code change needed.

3. **Redeploy the order-creation function** so it picks up the new keys, then create a small test order and confirm it returns the new `rzp_live_…` Key ID.

4. **Verify the webhook end to end**: call the webhook URL and confirm it answers correctly (rejects a bad signature with 401, accepts a properly signed test event).

## What you must do in the Razorpay Dashboard (I can't do this part)

1. Settings → API Keys → generate/copy the **Live** Key ID and Key Secret.
2. Webhooks → add webhook:
   - URL: `https://user.badiyos.com/api/public/webhooks/razorpay`
   - Events: `payment.captured` and `order.paid`
   - Secret: create a strong random value and keep it — you'll paste the same value into the secure form here.

## Notes

- Old/test keys stop working the moment the new secrets are saved; orders in progress at that moment would need to retry payment.
- No changes to the Android app or a new Play Store upload are required — the APK loads the live site.
