# Apply Updated Razorpay Keys

You have saved new `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. This plan activates them everywhere.

## Steps

1. **Rebind secrets** so the backend picks up the new key values.
2. **Redeploy the payment function** (`create-razorpay-order`) so it runs with the new keys.
3. **Verify with a real test order** — create a small order and confirm the response shows the new live key ID and the correct amount (price + 5% GST).
4. **Confirm the webhook** at `https://user.badiyos.com/api/public/webhooks/razorpay` still verifies correctly with the saved webhook secret.

## You may need to do (Razorpay dashboard)

- If the **key pair changed** (new account or regenerated keys), the webhook secret usually stays the same — but if you also regenerated the webhook secret, save the new one via the secure form.
- Confirm the webhook in the Razorpay dashboard points to `https://user.badiyos.com/api/public/webhooks/razorpay` with events `payment.captured` and `order.paid`.

## Notes

- The website and the Play Store app both load the live site, so no new app build is needed — the keys take effect server-side immediately.
- No design, pricing, or flow changes.
