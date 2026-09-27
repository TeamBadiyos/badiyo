# Daily trip numbers, packet QR codes and scan-before-OTP (backend only)

Only business trips change. Customer parcel orders and store deliveries stay as they are.

## 1. Daily trip numbers
- New counter record per business: business, IST date, last trip number.
- When a trip is created, lock the business's counter row, reset it if the IST date changed, add 1, and save that as the trip number.
- Numbers keep counting across runs on the same day (12:00 run T1–T8, 14:00 run T9–T15) and start again at T1 after midnight IST.
- Drop labels stay C1, C2… within each trip.

## 2. Packet list
- New packet table: trip, courier order, drop stop, drop label, packet number, packet total, code (unique), pickup scan time, drop scan time, created time.
- When a trip is finalized, one row is made per packet. Packet counts are added up per drop (merged same-receiver orders included) and numbered 1..n per drop.
- Code format: `T12-C3-2-XXXX` (4 random letters/digits). A retry is made if the code clashes. The QR holds this code.
- Owning business and ops can read the table. Riders read it only through the actions below.

## 3. Rider actions (assigned rider only)
- `courier_scan_packet(order, code, stage pickup|drop, stop)` returns ok / wrong_trip / wrong_stop / already_scanned / unknown, plus scanned/total for that stage and stop.
  - Pickup: any packet of the trip counts. Drop: the packet must belong to that drop stop.
- `courier_trip_packets(order)` returns the packet list with scan status.

## 4. Scan before code (business trips only)
- Confirming the pickup code is refused with `packets_not_scanned` until every packet of the trip is scanned at pickup.
- Confirming a drop code is refused until every packet of that drop is scanned at drop.
- Ops override: `staff_courier_skip_scan(stop, reason)` marks the stop as skipped, needs a reason, and is audit logged.
- Customer courier orders and older trips with no packet rows are not affected.

## 5. Business code view and labels
- `business_get_trip_otps` also returns the trip number and, per drop, each packet's code and packet number/total.

## Technical details
- One migration. Every function change starts from its live definition (`courier_verify_stop_otp`, `business_finalize_batch` / `courier_create_business_order`, `business_create_trip`, `business_get_trip_otps`).
- Before writing it, check: the business_orders packet-count column name, where trip_no is set today (the planner route vs SQL), the audit helper signature (6 args), and the staff-role check that ops actions use.
- New tables get grants, RLS and the touch trigger. The skip flag goes on a new `courier_order_stops.scan_skipped_at/by/reason` column.
- The trip number is set in SQL at trip creation. If the planner route passes its own run-local trip_no, the route stops using it for display (small code change, type check).
- Rollback test (written, not run), following the real path: 2 receivers, 3 packets on drop 1 and 1 on drop 2, so 4 packet rows with unique codes. Then:
  - Pickup code refused before scans; wrong-trip, unknown and duplicate scans give the right results.
  - After all pickup scans, pickup succeeds. Drop 1 is refused until its 3 packets are scanned at drop; a drop-2 packet scanned at drop 1 gives wrong_stop.
  - The ops skip on drop 2 lets its code through.
  - A second run the same day continues the trip numbers, and a faked next IST day resets to 1.
  - Business code view shows the codes and trip number.
- Report every function and table created or changed.
