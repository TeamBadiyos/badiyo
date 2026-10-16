# Store/Food: shared Checkout, item search, guest distances

## 1. Shop orders on the shared Checkout
- Store and Food "View cart" opens the same Checkout as Clean:
  - Address card (Change opens the address sheet)
  - Items card: name, Half/Full and add-ons shown, − qty +, "+ Add more items" (back to that shop)
  - "You save ₹___" (MRP − price, shown only when above 0)
  - Coupon + badiyos Wallet card
  - "Note for rider" (Store) / "Note for restaurant" (Food), max 300 chars
  - Bill: items, delivery fee from the backend quote, GST as the backend returns it, coupon discount, wallet, total
  - Pay ₹___ (Razorpay) or Pay with wallet when the wallet covers the total; partial wallet + Razorpay for the rest
- English + मराठी. Guest sign-in is asked on Pay.
- Old shop checkout screen deleted afterwards.

### Backend (new, nothing renamed or dropped)
- Today the shop order backend takes only items, address, note and online payment. It gets optional coupon and wallet inputs, reusing the existing coupon rules (limits, category/service restrictions, reservation + release on cancel/expiry) and the new wallet (cash first, then bonus; refunded on cancel/expiry).
- A shop quote call returns items total, MRP total, delivery fee, GST, coupon discount, wallet use and total, so the bill shown equals what is charged.
- When the wallet covers everything, the order is paid at once with no Razorpay and goes straight to the order tracking screen.

## 2. Search items too
- New public search (no login): for a tab (store/food), city and location, returns matching live stores and matching live items by item name or category name.
- Results: "Stores" list, then items grouped by store (store name, distance) with + Add / − qty + (Food items with sizes/add-ons open the choice sheet). Closed stores' items greyed with Add disabled. Same one-cart rule.

## 3. Guests without a saved address
- If location permission is already given, use the device location for distances and nearest-first sorting on Store/Food home, search and store page.
- No permission / no location: distances hidden, stores sorted open first only. No new permission prompt here.

## Technical details
- Migration: `store_create_order` gains `_coupon_code text default null`, `_use_wallet boolean default false` (new overload-safe signature replacing via CREATE OR REPLACE with defaults so current callers keep working); new `store_checkout_quote(_merchant_id, _items, _address_id, _coupon_code, _use_wallet)`; new `app_commerce_search(_service_key, _city_id, _q, _lat, _lng)` SECURITY DEFINER, anon-executable, returning only public store/item fields, reusing `app_store_live`/`app_item_live`/`app_item_card`. Cancel/expiry paths (`store_cancel_order`, `store_expire_unpaid`) release coupon and refund wallet.
- Frontend: generalize `BookingSummaryScreen` with a commerce mode (items card instead of booking card); `storeOrders.ts` adds quote + coupon/wallet params; `CommerceTab` search uses the new function; device location via the existing geolocation helper when permission state is granted, passed as lat/lng to `app_commerce_home`/search/store page. Delete `StoreCartScreen.tsx` and its lazy import in `HomeScreen.tsx`.
- Not testable here with a real payment or sign-in.
