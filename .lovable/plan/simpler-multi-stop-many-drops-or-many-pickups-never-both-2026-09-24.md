# Simpler multi-stop: many drops OR many pickups, never both

Store deliveries and normal 1 pickup + 1 drop orders stay exactly as they are.

## 1. Order check (server)
- `courier_create_order` rejects any order with more than 1 pickup AND more than 1 drop, for every customer segment, with: "Choose either multiple drops or multiple pickups".
- Parcel check updated to match:
  - 1 pickup, many drops: exactly one parcel per drop, all from that pickup.
  - Many pickups, 1 drop: exactly one parcel per pickup, all to that drop.
- The max pickups/drops limits (empty = no limit) and everything else in the function stay the same.
- The friendly error for this message is added to the app's parcel error text.

## 2. Booking screen: pick a mode
Shown at the top only when the rate allows more than 1 pickup or drop:
- **Send to one place** (default): today's 1 pickup + 1 drop.
- **Send to many places**: 1 pickup, "Add drop" up to max drops.
- **Collect from many places**: "Add pickup" up to max pickups, 1 drop.

A mode shows only if its limit is above 1. Switching mode keeps Pickup 1 and Drop 1 and removes the extra stops, and clears the price.

## 3. Automatic parcels
- The "Parcel from" chips, the per-drop choices, and the "Drop 1: from ..." summary lines are removed.
- Parcels sent with the order are built automatically: one per drop (many drops) or one per pickup (many pickups).
- Continue only needs every stop filled in, as for other fields today.

## 4. Remove parcel counts
- Tracking screen: remove the "2 of 3 parcels delivered, 1 returned" line.
- Stops timeline, per-stop codes with Share, return charge card and all else unchanged.

## 5. Review screen
Route list and fare with the extra stops fee line, as today.

## Technical details
- New migration: `create or replace` of `courier_create_order` with the shape check before other multi-stop validation, and the parcel rule rewritten (count = drop_count when pickup_count = 1, else pickup_count; each parcel pair unique and matching the single stop).
- `CourierBookingScreen.tsx`: new `mode` state (`single` | `multiDrop` | `multiPickup`); `canAddPickup/canAddDrop` depend on mode; remove `dropSources`, `sourcesOf`, `sourceSummary`, `showSources`; parcels derived from stop keys.
- `RouteTimeline.tsx` / `MultiStopEditor.tsx`: drop the `SourceChips` usage and props.
- `CourierTrackingScreen.tsx`: stop rendering `parcelSummary`.
- `courierError.ts`: map the new message. New en/mr keys for the three mode labels.
