# Pre-printed QR seal stickers + "1 packet = 1 order" (backend only)

No screens change. Old business orders, trips and packet codes keep working.

## 0. Read the live database first
Before writing anything, read the real columns and live function definitions for every table and function in the brief (business_orders, business_trip_packets, business_batches, receivers, pickup points, business_qty_check_state, merchants, bulk_pricing_plans, courier_order_stops, courier_order_charges; business_group_and_batch, business_create_trip, business_finalize_batch, courier_create_business_order, business_create_trip_packets, courier_scan_packet, courier_trip_packets, business_cancel_trip, business_reject_trip_internal, staff_business_reject_trip, business_cancel_order, business_requeue_order, business_create_order, business_wallet_post, business_audit, business_require_delivery / business_require_ops, and the trip pricing inside business_finalize_batch). Every changed function starts from its live definition. No columns are renamed or dropped.

## 1. Sticker codes
- Code = 6-digit serial + 1 Luhn check digit (104521 becomes 1045217). The QR holds "BDY1045217" and the printed text is "BDY 104521-7".
- `seal_code_normalize(text)` accepts any of those forms (spaces, dashes, lowercase all fine) and returns the 7 digits, or null.
- `seal_luhn_ok(text)` checks the check digit.

## 2. Tables
- **business_seal_batches:** sequential batch number, serial range, business, assigned date, charge, notes, who created it.
- **business_seal_stickers:** code, serial, batch, business, status (unassigned / available / used / void), linked order (one only), entry method (scan / manual), used and void times, void reason.
- **Who can see them:** staff see all; a business's members see only their own stickers. Nobody writes directly, only through the actions below.
- **business_orders:** new sticker code (unique, linked to the sticker) and entry method. Invoice number, description and packet count become optional or defaulted if they aren't already.
- **business_trip_packets:** pickup and drop entry method.
- **bulk_pricing_plans:** drop count basis, "packet" (default) or "shop".

## 3. Actions (every write is recorded in the audit log)
- **Staff actions**, using the same ops check as other business staff actions:
  - create a batch (up to 50,000 stickers, overlapping ranges refused)
  - assign a batch to a business, with an optional wallet charge. If the wallet is short, it's refused with INSUFFICIENT_WALLET and nothing is assigned.
  - void a sticker (refused after pickup)
  - export a batch for printing
  - look up a sticker
- **Business actions:**
  - `business_seal_check` returns ok, or INVALID_FORMAT / BAD_CHECK_DIGIT / NOT_FOUND / NOT_YOURS / ALREADY_USED (with the order's details) / VOID.
  - `business_create_packet_orders` creates one order per sticker for one receiver, up to 50 per call. It's all or nothing: stickers are locked, duplicates in the list are refused, and every failed code comes back with its reason. It runs the same checks as today's create-order action, reused internally, so the order-count trigger keeps working (it now counts packets).
  - `business_seal_stock` returns stock counts and average daily use.
- **Cancel or reject before pickup** (business cancel, trip cancel, ops reject, the auto-reject at the next run): the sticker becomes void. **Re-send / requeue:** the sticker stays linked.

## 4. Trip packets and rider scan
- A sealed order's packet code is its sticker code. Unsealed orders keep the generated code.
- `courier_scan_packet` gets a new entry-method input (default "scan"). The code is normalized before matching, and old codes still match. Typed codes go through exactly the same checks. The entry method is saved.
- `courier_trip_packets` also returns entry methods and the printed format.

## 5. Billing (no fixed rupee values)
- Every amount comes from the business's pricing plan.
- The number of drops billed follows the plan's basis: "packet" counts the trip's orders, "shop" counts its unique receivers (today's behaviour).
- Rider stops, route planning and the per-trip drop limit always count receivers.
- Rider pay uses the same billed drop count. Trip charges record the packet count and the basis used. The cancel fee is unchanged.

## 6. Test script
A rollback test is written but not run. It covers every case in the brief, and the billing check reads its rates from the test plan.

## Technical details
- One migration. Check digit functions are IMMUTABLE. The overlap check uses a lock on business_seal_batches. The sticker insert uses generate_series.
- The old `courier_scan_packet` version (4 inputs) is dropped and recreated with a 5th input that has a default, so existing calls keep working.
- Stickers are voided inside business_reject_trip_internal and business_cancel_order, and not inside the requeue path.
- The billed drop count is added where business_finalize_batch computes the extra drop fee. It's snapshotted in fare_breakdown and courier_order_charges, and courier_settle_order reads the same count, so rider pay matches.
- Grants: tables get authenticated select and service_role all, with RLS on and select policies only. Actions are SECURITY DEFINER with a fixed search_path, execute revoked from anon and granted to authenticated. The internal helpers are revoked from authenticated.
- Afterwards: report every table and function created or changed, and the expected security warnings.
