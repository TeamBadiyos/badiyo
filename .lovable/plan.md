# Multi-drop OTPs: show all at once when the parcel is on the way

## What the checks found

- **Server side looks right already.** Once the last pickup code is confirmed, the order moves to "in transit" and a code is created for every pending drop in one go. Both paths do this: the step after pickup verification and the rider's "start trip" action.
- **Reading the codes is not limited to arrival.** The customer's code list and the contact's view both return a drop code as soon as it exists and has not been used or expired. Neither one checks whether the rider has arrived.
- **The tracking screen shows every code it gets back** and checks for new ones every 15 seconds.
- **The live data can't confirm the bug yet.** No multi-drop order has reached "in transit" so far. The only 2 recent ones were cancelled before pickup. So the reported behaviour hasn't happened on a real order yet. Code created when the rider reaches a drop is only a backup, used when no code exists or the old one expired.

**The root cause isn't confirmed yet.** The first step below proves it one way or the other before anything is changed.

## Steps

1. **Rollback test (you run it, nothing is saved).** It uses a real multi-drop order inside a test transaction: confirm the pickup code, then read the customer's code list and each drop contact's view right away, before any drop arrival. It reports which drop codes are visible at each step.
   - If a drop code is missing, the test shows which step drops it, and I fix that one step on the server.
   - If all codes are visible, the server is fine. I then make sure the tracking screen reloads the codes the moment the order goes "in transit" instead of waiting up to 15 seconds.
2. **"Share all OTPs" button on the tracking screen.** It appears above the stops list when 2 or more drop codes are visible. It shares one message like:
   ```text
   Badiyos parcel BS123 – delivery codes
   Drop 1 (Kothrud, Pune): 4821
   Drop 2 (Baner, Pune): 7390
   Share each code only with the rider at that drop.
   ```
   The Share button on each stop stays as it is. Text comes in English and Marathi.
3. **"Parcels for you" (contact view).** The drop code shows as soon as the order is in transit, whether or not the rider is heading to that drop next. The code already doesn't depend on the "next stop" check; that check only controls the live map. I'll confirm this in the step 1 test and add a short line: "Rider will reach you after earlier drops".

## Technical details

- Functions checked: courier_recompute_order_progress (creates codes for all pending drops that have picked parcels), courier_rider_advance IN_TRANSIT (same loop), courier_rider_arrive_stop (makes a new drop code only if none exists or it expired), courier_stop_visible_otp (hides a code only when the stop is finished, the code is missing, already used or expired), courier_get_order_otps, courier_get_contact_view.
- Front end: CourierTrackingScreen `courier-order-otps` query (key includes status, refetches every 15s), StopsTimeline, ContactParcels. New `otpShareAllText(orderCode, drops, t)` in otpShare.ts; new en/mr keys `courier.shareAllOtps`, `courier.shareAllHeader`, `courier.riderAfterEarlierDrops`.
- There's no server change unless the step 1 test shows one is needed. Normal 1+1 orders are not affected.
