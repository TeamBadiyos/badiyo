# Multi-stop parcels: customer screens

Normal bookings with 1 pickup and 1 drop look and work exactly as today. Multi-stop options appear only when the selected city and vehicle allow more than 1 pickup or drop.

## 1. Stop limits
- A new server function, `courierGetRateLimits(city, vehicle_type_id)`, returns the regular-rate `extra_pickup_fee`, `extra_drop_fee`, `max_pickups` and `max_drops`.
- The "Add pickup" and "Add drop" buttons show only when the matching limit is above 1.

## 2. Booking screen
- **Pickups section:** Pickup 1 (today's fields), plus "Add pickup (+₹fee)" up to the limit.
- **Drops section:** Drop 1, plus "Add drop (+₹fee)" up to the limit.
- Each extra stop has an address picker (the existing one), a name and a 10-digit phone, and can be removed.
- **"Parcel from"**, only when there are 2 pickups: each drop shows the chips Pickup 1 / Pickup 2 / Both. "Both" creates two parcels.
- Continue is blocked until every drop has a source and every pickup is used by at least one drop. With 1 pickup there is no extra UI.
- **Route:** call `courierPlanStops`, then show the planned order as a small numbered list ("1 Pickup · 2 Pickup · 3 Drop ...").
- **Quote:** get the price with the stop counts and the planned stops.
- **Fare breakdown:** distance fare, extra stops fee (only if above 0), parcel type fee, platform fee, discount, GST, total.
- **Place order:** send the stops in route order with their keys, plus the parcels, then use the existing payment flow.
- **Friendly errors:**
  - DISTANCE_MISMATCH: "Route changed, please refresh the price"
  - Maximum stops reached
  - Outside the delivery area
  - Service closed

## 3. Tracking screen
- **Stops timeline in route order:** each stop shows a Pickup / Drop / Return badge, the address, the contact and a status chip. The rider's current stop is highlighted. The live rider map stays.
- **Codes:** loaded with `courierGetOrderOtps`. Each visible code sits on its stop with a Share button, which opens the phone's share menu, or WhatsApp as a fallback. Share text: "badiyos parcel OTP for [Pickup/Drop] at [short address]: [OTP]. Share it only with the badiyos rider at the location."
  - When no code is visible, a helper line says: "OTP appears here when the rider reaches the pickup / leaves for the drops."
- **Edit contact per stop:** uses a new server function, `courierUpdateStopContact`, with the same limits as today. The codes reload afterwards, so the new code shows automatically.
- **Return charge:** if a charge is pending, a highlighted card shows at the top: "Delivery could not be completed at Drop N. Pay ₹X return charge to get your parcel back." The Pay button calls `createReturnChargePayment` and opens the existing Razorpay sheet. The screen checks every 10 seconds until the charge is paid, then shows "Return charge paid".
- **Final states:**
  - Delivered, with a parcel count such as "2 of 3 parcels delivered, 1 returned"
  - Failed delivery
  - Cancelled; when every pickup failed, it says "Pickup could not be completed at the sender's location"

## 4. Orders list
- Multi-stop parcels show "N pickups · M drops".
- A "Return payment pending" chip shows when a return charge is unpaid.

## 5. Parcels for you (contact view)
- **"Parcels for you" card:** shown on Home and in Orders when `courierMyContactDeliveries` returns anything. Each row shows a label (Parcel coming to you / Pickup from you / Return to you), the sender and the status.
- **Detail screen**, using `courierGetContactView`:
  - status
  - rider name, photo and vehicle
  - their code, with the same Share button and the note "Give this OTP to the rider only when you receive/hand over the parcel"
  - the live rider map, only while this is the rider's next stop; otherwise "The rider will reach you after the current stop"
  - no price or payment details
- **Push:** tapping the "Parcel update" notification opens this list. Its link changes to a parcels-for-you address that the app handles.

## 6. Texts
Short, matching the app's current style, in English and Marathi. Nothing about Business/Corporate.

## Technical details
- **Distance for multi-stop:** today the server works out the distance from pickup to drop only. The quote and order server functions will accept optional `stops`, and for multi-stop they calculate the road distance across all stops in the planned order: Google Routes with waypoints, falling back to straight-line distance × 1.3. The app still never sends a distance, and 1+1 keeps today's method.
- **Contact edit:** `courierUpdateStopContact` wraps the `courier_update_stop_contact` database function.
- **Rate limits:** `courierGetRateLimits` reads the `courier_vehicle_rates` table (prices per city and vehicle) for the regular segment only. It returns nothing else.
- **Server functions:** all new and changed ones require sign-in and live in `src/lib/courier.functions.ts`.
- **Tracking data:** the tracking screen reads stops, parcels and charges through the existing parcel-order read rules. If those rules don't allow it, it falls back to `courierGetOrderOtps`, which already includes stop details.
- **Screen code:** the booking screen's stop editing moves into a new `MultiStopEditor` component. The tracking timeline becomes a new `StopsTimeline` component. The contact view gets `ContactParcelsCard` and `ContactParcelScreen`. The contact detail screen becomes a new screen state in `src/routes/index.tsx`.
- **Push:** the "Parcel update" notification's link changes from `/` to `/?parcels-for-you`.
- **Testing:** after building, run the type check and open the booking screen as a signed-in user to confirm a 1+1 booking looks unchanged. Multi-stop options won't show while the live rate is set to 1 pickup / 1 drop.
