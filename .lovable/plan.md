# Live tracking map: real road route and 3D worker markers

## Goal

Tracking map par straight line hata kar Google ka actual road-following route dikhana, aur generic blue dot ko service ke hisaab se realistic 3D-style worker marker se replace karna.

## 1. Actual road route

### Parcel tracking
- Pickup se pehle rider ki live location se pickup address tak road route dikhayenge.
- Parcel pickup hone ke baad rider se drop address tak route switch hoga.
- Pickup aur drop ke beech ka current straight `Polyline` poori tarah remove hoga.
- Google Routes API se encoded road polyline lekar map par Badiyos green route draw hoga.
- Rider move kare to route refresh hoga, lekin har 8-second poll par nahi: sirf meaningful distance/time threshold ke baad, taaki route stable rahe aur Maps cost/control safe rahe.
- Route response na aaye to fake straight line nahi dikhayenge; markers aur live-location status chalte rahenge.

### Home service tracking
- Expert assigned/on-the-way state me expert ki current location se customer ke service address tak actual road route dikhayenge.
- Expert location update hone par wahi controlled refresh rule use hoga.
- Booking ke address marker ko destination marker hi rakhenge.

## 2. Two realistic 3D-style symbols

User-selected two-symbol setup:

1. **Rider/worker marker** — courier aur Auto Care/car cleaning ke liye.
   - Small isometric 3D-style rider/field-worker figure.
   - Map par clearly readable silhouette, Badiyos green accent, transparent background.
2. **Woman worker marker** — Home Care/maid services ke liye.
   - Small standing woman professional figure, realistic 3D-style render.
   - Respectful uniform, clear silhouette, Badiyos green accent, transparent background.

Implementation:
- Dono marker images specifically map-size readability ke liye generate honge; uploaded screenshot sirf visual reference rahega, app asset nahi banega.
- Google marker icon me correct anchor and fixed rendered dimensions rahenge, so figure coordinate ke upar correctly stand kare.
- Marker old blue circle ko replace karega aur live location ke saath move karega.
- Existing category data se reliable selection hoga: `courier-delivery` and `car-bike-wash` → rider/worker; `home-cleaning` → woman worker.
- Unknown/legacy category ke liye neutral worker fallback rahega.

## 3. Reliable service identification

- Home booking tracking ko saved `service_category_id`/category slug milega instead of display label guessing.
- Existing booking reopen flow (Orders/My Bookings) bhi category information carry karega, so direct open ya app relaunch ke baad correct icon hi aaye.
- Customer-owned tracking read me only necessary category slug expose hoga; ownership checks remain unchanged.

## 4. Secure and cost-controlled route service

- Authenticated server function Google Routes API call karega; secret key browser me expose nahi hogi.
- Input coordinates validate aur Latur-area route request bound ki jayegi.
- Repeated identical/near-identical route calls short cache se deduplicate honge.
- One request at initial live route, then only after meaningful rider/expert movement or destination/stage change.
- Existing live-location polling intervals remain; route fetching independently throttled rahega.
- Google Maps usage metered hai, isliye uncontrolled per-location fan-out nahi hoga.

## 5. Files and data changes

Likely app files:
- `src/components/courier/CourierLiveMap.tsx`
- `src/components/tracking/ServiceLocationMap.tsx`
- `src/components/tracking/ExpertAssignedScreen.tsx`
- `src/components/courier/CourierTrackingScreen.tsx`
- `src/components/OrdersScreen.tsx`
- `src/components/MyBookingsScreen.tsx`
- `src/routes/index.tsx`
- New shared authenticated route helper under `src/lib/`
- Two generated transparent marker assets under `src/assets/`

Database:
- No new table required.
- If the existing customer tracking RPC cannot return category slug cleanly, update that RPC in one migration while preserving booking ownership and authenticated-only access.

## 6. Verification

- Parcel before pickup: rider → pickup follows roads.
- Parcel after pickup: rider → drop follows roads.
- Home Care booking: woman marker + road route to customer.
- Auto Care booking: rider/worker marker + road route to customer.
- Marker moves without duplicating old markers or route lines.
- Route failure shows no misleading straight line.
- Check narrow Android viewport and desktop preview for framing, overlap, map loading, and console/network errors.
- Verify reduced data/request behavior by confirming route calls are throttled while location polling continues.

## Not changed

- Courier pricing/distance quote calculation.
- Dispatch, OTP, payment, refund, or booking status logic.
- Rider/expert location polling frequency.
