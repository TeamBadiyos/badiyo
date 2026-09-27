# Seal stickers: follow-up changes

## 1. Check digit
No change. Standard Luhn stays (104521 becomes 1045210).

## 2. Cancel and reject behaviour
- **Cancelling a single order before pickup** (business_cancel_order, the only single-order cancel) voids its sticker. That stays as it is.
- **A whole trip cancelled before pickup:** sealed orders go back to waiting exactly like unsealed ones. The sticker stays linked and "used". This covers:
  - business cancel (business_cancel_trip)
  - ops reject (staff_business_reject_trip)
  - the auto-reject at the next run
- **Rules that stay the same:** cancel fee and refund rules, and after pickup stickers are never touched.
- **When the trip is planned again:** the sticker code is reused as the packet code. The old packet row from the cancelled trip is removed first, which is already built in.

## 3. Order-count trigger
No change: it keeps counting shops.

## 4. Updated test script (full, not run)
- The wallet credit moves right after the setup checks, before any orders are created.
- **New step A:** create a trip from 2 sealed orders, then call business_cancel_trip before pickup. Expect the trip rejected, both orders back to pending, and their stickers still "used" and linked to the same orders.
- **New step B:** the same using staff_business_reject_trip as ops.
- All earlier steps stay unchanged.

## Technical details
- One migration, from the live definitions of business_cancel_trip and staff_business_reject_trip. It removes the call to business_seal_void_for_batch and the "stickers_voided" field in their replies. Everything else stays byte-for-byte the same.
- The helper business_seal_void_for_batch is dropped, since nothing uses it any more.
- Step A and step B each insert a dispatch run and a planning batch, then call business_finalize_batch (a trip needs status "dispatched" and a courier order). They then cancel or reject, and check business_orders.status = 'pending' plus business_seal_stickers.status = 'used' with business_order_id unchanged.
