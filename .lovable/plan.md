# Parcel tab — Rapido-style rebuild

Same app header and 5 bottom tabs on Parcel home; booking steps open full-screen with ← (like Clean booking). English + मराठी throughout. Reuses existing pricing (`courierQuote` / `courierGuestQuote`), multi-stop planning (`courierPlanStops`), order creation/payment (`courierCreateOrder`, `courierConfirmPayment`) and tracking. No new tables.

## 1. Parcel home (inside the tab)
- Top ~50%: map centred on pickup, "my location" button, no rider icons.
- Card: "🟢 Pickup: label · area ✏️" (opens the shared address sheet) and a big "🔴 Where to send?" search box (opens drop search page: saved addresses, recent drops, map pick).
- Chips: saved addresses + last 3 drop locations (stored on device).
- Link "+ Send to many places" → multi-drop / multi-pickup page in new style (reuses MultiStopEditor logic).
- When closed: thin top line "🕐 Opens 9 AM" (from service hours); start allowed only if service allows; no other banners.
- Guests can browse and see prices; login asked at Pay.

## 2. Choose vehicle (full-screen page)
- Map with pickup → drop route and distance.
- Vehicle cards: icon, name, weight limit (CC), price from backend quote; selected = green border + light green bg.
- "What are you sending?" chips from CC parcel types.
- Receiver name + phone, with "Pick from contacts" (native contacts on phone; typed entry on web).
- "Continue · ₹___". No ETA, rider count or schedule.

## 3. Shared Checkout
Same layout as Clean/Store: "Pickup → Drop" card, vehicle, distance, parcel type, receiver; coupon sheet; badiyos Wallet; "Note for rider" (300 chars); bill (fare, GST as returned, coupon, wallet); Pay / Pay with wallet. Back returns to Choose vehicle with choices kept.

## 4. After payment
Existing "Finding a rider" and tracking screens, unchanged.

## Removals
Old `CourierBookingScreen.tsx` replaced; keep CourierTrackingScreen, CourierLiveMap, StopsTimeline, RouteTimeline, ContactParcels, otpShare, courierData. Final reply lists exactly what was deleted.

## Technical details
- New `src/components/parcel/`: `ParcelHome.tsx`, `ParcelDropSearch.tsx`, `ParcelVehicleScreen.tsx`, `ParcelMultiStopScreen.tsx`, `parcelDraft.ts` (draft state like cleanBookingDraft, survives back), `parcelCopy.ts` (EN/MR).
- Checkout: new `ParcelCheckoutScreen` built on the same pieces as CommerceCheckoutScreen/BookingSummaryScreen + CouponSheet; wallet via `app_wallet_summary`.
- Full-wallet / coupon on courier orders: inspect `courierCreateOrder` first. If it already supports coupon + wallet, reuse; if not, add a non-destructive `courier_place_order`-style SQL function (reserve coupon, spend wallet, mark paid when covered, release on cancel/refund) mirroring the Store pattern — reported back if added.
- HomeScreen Parcel tab renders ParcelHome; routes/index.tsx phases for drop/vehicle/multistop/checkout; hardware back parity.
- Not testable here: sign-in, real payment, contacts picker on phone.
