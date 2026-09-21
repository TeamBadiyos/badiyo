# Send a Parcel — off-hours browsing, final-step ordering guard

## Goal

Service band hone par bhi customer **Send a Parcel ka poora 4-step flow**, available vehicles, parcel limits, route, exact quote aur complete fare breakup dekh sake. Full-page “We’re closed right now” screen hata deni hai. Rok sirf order/payment start karte waqt lagegi.

## Customer experience

### 1. Small closed notice, full page nahi

- Parcel screen normal tarah khulegi.
- Header ke neeche compact branded notice dikhega:
  - clock/status icon
  - short message, for example **“Orders are closed · Opens at 9:00 AM”**
  - holiday/custom message aur next opening date supported
- Notice scroll ke saath visible rahega, lekin addresses, vehicle, parcel details ya pricing ko cover nahi karega.
- English aur Marathi dono text honge.

### 2. Complete flow remains usable

Off-hours mein customer ye sab kar sakega:

1. Pickup/drop address aur contacts select karna
2. Available vehicle aur capacity dekhna
3. Parcel type, weight, restrictions aur rider note bharna
4. Server se exact distance-based quote lena
5. Delivery charge, handling, platform fee, discount, GST aur final total dekhna

Entered details aur quote screen par preserved rahenge; closed message ke baad user ko form dobara nahi bharna padega.

### 3. Final action par clear stop

- Review page ka final order/payment button visible rahega.
- Customer button tap karega to app latest service status fresh check karega; 60-second cached value par depend nahi karega.
- Agar service abhi band hai, payment ya order create nahi hoga. Branded bottom sheet/dialog dikhega:
  - **“Ordering is closed right now”**
  - custom/default reason
  - exact next opening time/date
  - **Got it** action; user review page par hi rahega
- Agar isi beech service open ho gayi ho, normal payment/order flow continue hoga.
- Tap ke dauran button loading state mein rahega, taaki duplicate attempt na ho.

## Status behavior

- **Hours closed / holiday / last-order buffer:** full parcel flow and quote visible; only final order blocked.
- **Temporarily Stopped:** details and pricing visible, but final order blocked with custom message/resume time.
- **Coming Soon:** details may be browsed, but final order blocked; status message clearly says service has not launched yet.
- **Hidden:** normal navigation se tile hidden hi rahega; stale deep link se khulne par order cannot be placed.
- Reviewer/test bypass users ke liye existing server permission unchanged rahegi.

## Safety and pricing

- Existing server-side order enforcement remains authoritative, so old app, deep link, stale screen or timing race se closed-time order create nahi hoga.
- Final tap ke fresh status check ke baad bhi server rejection aaye to wahi friendly closed dialog khulega—not a raw error.
- Quote sirf estimate display ke liye nahi hoga: order creation par server existing authoritative quote/price validation dobara karega.
- Razorpay tab tak open nahi hoga jab tak service currently orderable confirm na ho.
- ₹0/full-discount parcel ka direct-confirm flow bhi isi final service check ke baad chalega.

## Files to update

- `src/components/courier/CourierBookingScreen.tsx`
  - full-page early closed return remove
  - compact status notice add
  - final-tap fresh status check
  - closed dialog/bottom sheet and server-race error handling
  - customer inputs/quote preserve
- `src/lib/serviceHours.ts`
  - one-shot fresh service-state fetch/refetch helper if needed; existing fail-open behavior preserved for read failures
- `src/i18n/en.ts` and `src/i18n/mr.ts`
  - compact banner, final-order block, “Got it”, and next-opening copy

No database migration is expected: quote flow already works separately, and server-side courier order enforcement already blocks closed orders.

## Verification

Test on a narrow Android viewport:

1. Off-hours click on Send a Parcel opens the real booking flow, not the full-page closed screen.
2. Compact notice fits below the safe area without overlap.
3. All four steps work and fare breakup is visible while closed.
4. Final button shows the closed dialog and does not open Razorpay or create an order.
5. Form values and quote remain intact after dismissing the dialog.
6. Opening time/date, holiday/custom copy, Coming Soon and Temporarily Stopped render correctly in English and Marathi.
7. Status changing from closed to live before final tap allows checkout after the fresh check.
8. Status changing from live to closed before final tap is caught by the server and shown as the same friendly dialog.
9. ₹0 parcel cannot bypass the closed-state check.
10. Existing service-area, weight, restricted-item and payment validation remains unchanged.
