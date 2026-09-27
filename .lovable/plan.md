# Partial pickup: leave some packets behind (backend only)

No screens change. Normal trips, customer parcels and store deliveries work as before.

## 0. Read the live database first
Before writing anything, read the real columns and live definitions for business_orders, business_trip_packets, business_batches, business_seal_stickers, courier_orders, courier_order_stops, courier_order_events, courier_order_parcels, courier_order_charges; and business_finalize_batch (trip pricing), courier_create_business_order, business_create_trip_packets, courier_scan_packet, courier_trip_packets, courier_verify_stop_otp, business_cancel_trip / business_reject_trip_internal, business_requeue path, business_wallet_post, business_audit, business_notify, the rider push helper, courier_settle_order and business_get_trip_otps. Every changed function starts from its live definition.

## 1. Record of removed packets
Packet rows are deleted (so the sticker code can be reused), so a new table **business_trip_removed_packets** keeps the history: trip, courier order, business order, receiver, drop label, packet code, reason code, notes, removed by (rider / business), who, when. Readable by the owning business and ops; no direct writes.

## 2. Actions
- **Rider:** `courier_rider_leave_packets(order, packet ids, reason code, notes)` — assigned rider of a business trip only. Reasons NOT_READY / BUSINESS_HOLD / DAMAGED / OTHER (notes required for OTHER). No business confirmation.
- **Business:** `business_remove_packets_from_trip(trip, order ids, reason)` — owner or staff with delivery permission.
- **Both:** only before the pickup is completed, and only for packets not yet scanned at pickup. Otherwise refused with a clear reason (`pickup_done`, `packet_scanned`, `not_in_trip`).

## 3. Shared effect (one internal function)
- Each removed order: unlinked from the trip exactly like the trip-cancel path, back to pending (joins the next run). Sticker stays "used" and linked. Its packet row is deleted; its parcel removed from the courier order.
- A drop with no packets left: its stop is marked skipped/removed so the rider no longer sees it. Other stops keep their labels and order.
- **All packets removed:** goes through the existing business trip cancel (fee rules apply since the rider is at pickup), orders pending, stickers kept.
- **Otherwise:** fare recalculated from the trip's pricing plan snapshot — billable drops by the plan's drop count basis, distance for the remaining route by the same method the trip used (Google-planned trips: remaining legs recomputed with the stored stop order via the backup straight-line × 1.3 method, since the database can't call Google). fare_breakdown, charges and rider earning updated. The difference is refunded to the delivery wallet with `business_wallet_post` (reason "Packets removed from trip C<no>"), once per removal. No cancel fee.
- Pickup can be confirmed once all **remaining** packets are scanned (already true, since removed rows are gone).
- A courier_order_events row and an audit entry with who, packet codes and reason.
- Notifications: rider action notifies the business with the codes; business action notifies the rider.

## 4. Read changes
- `courier_trip_packets` and `business_get_trip_otps` also return removed packets (code, receiver, reason, removed by, time).
- New `business_left_behind_stats(merchant, date)` — counts per reason for that IST day (owner or ops).

## 5. Test script (rollback, written not run)
Trip with 3 receivers and several packets; rider leaves 1 packet of A and all of B → B stop removed, A stays, fare lower, refund posted once, orders pending, stickers "used", packet rows gone, history rows saved; leaving a scanned packet is refused; business removal gives the same effect; removing everything goes through the trip cancel with the fee rule. Ends with `TEST OK (rolled back)`.

## Technical details
- One migration. Actions are SECURITY DEFINER with fixed search_path; execute revoked from anon; the internal function revoked from authenticated.
- The refund is the difference between the old and new fare totals (incl. GST), never negative; idempotency key per removal id.
- Afterwards: report every table and function created or changed, plus expected security warnings.
