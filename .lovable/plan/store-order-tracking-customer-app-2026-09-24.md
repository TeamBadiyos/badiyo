# Store order tracking (customer app)

## Already done (last round)
- Checkout: items, delivery fee (Expert fare), total; online only through the existing Razorpay sheet; COD removed. No change needed, only a quick recheck.
- Orders tab already lists store orders with a store icon.

## What will be built

1. **Store order tracking screen** (new, reuses the parcel tracking pieces)
   - Five-step tracker: Order placed → Store accepted → Rider assigned → Picked up → Delivered.
   - From "Rider assigned": rider card (name, photo, call button) and live rider map — same components and data the parcel screen uses, read from the linked delivery job (the customer already owns that job, so existing rider info / live location / OTP reads work without new backend).
   - Items list, delivery address, bill (items, delivery fee, total, "Paid online").
   - Refreshes every 10–15 seconds while active.

2. **Delivery OTP card** — shown from "Picked up" until delivered, big 4-digit boxes (same style as parcel), text: "Rider ko ye OTP delivery pe batayein".

3. **Cancel / reject state** — when the shop rejects, does not accept in time, or admin cancels: red card "Order cancel ho gaya, refund 5-7 din me aa jayega" (shop's reason shown if given). Refund status line ("Refund in progress" / "Refunded").

4. **Orders tab** — every store order gets a clear "Store" label chip; tapping the card opens the tracking screen. Status labels match the five steps. Unpaid abandoned orders are hidden after 30 minutes (already).

5. **After payment** — checkout opens the tracking screen for the new order instead of just the Orders tab; it shows "Waiting for payment confirmation" until the webhook marks it placed.

## Technical notes
- New `src/components/store/StoreOrderTrackingScreen.tsx`; reuses `CourierLiveMap`, `fetchCourierOrder`, `fetchRiderInfo`, `fetchCourierOtp`/`store_get_delivery_otp`, and the OTP digit style (extract `OtpDigits` into a small shared file).
- `store_my_orders` needs `courier_order_id`, `reject_reason`, `refund_status` in its output (small DB function update, no table change). Add `fetchStoreOrder(id)` in `storeOrders.ts`.
- Wire in `src/routes/index.tsx` like the parcel tracking screen (`onOpenStoreOrder`), and from `OrdersScreen` / `StoreCartScreen.onDone(orderId)`.
- EN + MR text keys; Hinglish strings as given.
- Verify: typecheck, simulated status changes on a temporary order, mobile-size screenshot of the screen.
