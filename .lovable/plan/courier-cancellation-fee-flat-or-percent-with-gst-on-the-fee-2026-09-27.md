# Courier cancellation fee: flat or percent, with GST on the fee

Backend only. One helper decides the fee everywhere, so customer cancels, ops rejects and business cancels all charge the same way.

## Behaviour

- Ops can set the fee as a **percentage** of the trip (today 50%) or a **fixed rupee amount**. GST is added on top of the fee at the order's GST rate.
- The rider's share (today 50%) is taken from the fee before GST. GST never goes to the rider.
- The refund is what was paid minus the fee and its GST, and never goes below zero. Customers get it through the card refund, businesses get it back in the delivery wallet.
- Business pricing plans can have their own fee type and amount. Each trip keeps the plan's values from when it was created, so later changes to the plan don't affect it.
- The fee still only applies once the rider has reached pickup. Before that there's no fee.
- Worked example: ₹200 + 5% GST (₹210 paid), 50%, cancelled at pickup. Fee ₹100 + GST ₹5 = ₹105, refund ₹105, rider ₹50.

## Technical details

**Settings (ops_settings)**
- New `courier_cancel_fee_type` ('percent'|'flat', default 'percent') and `courier_cancel_fee_value` (default 50). The value is copied over from the current `courier_cancel_fee_pct`.
- Before writing, I'll check the type of `ops_settings.value`. If it's numeric, the type is stored as 0 = percent, 1 = flat and read through a small `courier_cancel_fee_type()` helper that returns text. Otherwise a text-setting helper is added.
- `cancel_fee_expert_share_pct` stays as it is. `courier_cancel_fee_pct` and `courier_cancel_fee_arrived` are left in place but nothing reads them any more.

**bulk_pricing_plans**
- Add `cancel_fee_type text not null default 'percent'` (percent/flat) and `cancel_fee_value numeric not null default 50`. A validation trigger enforces >= 0, and a max of 100 when the type is percent.
- `staff_upsert_pricing_plan` gets two new trailing parameters with defaults. The old signature is dropped and the new one created, with grants kept.
- `business_finalize_batch` (from its live definition) writes both values into the trip's `fare_breakdown` and into the courier order's `fare_breakdown`, as `cancel_fee_type`/`cancel_fee_value`.

**courier_orders**
- Add `cancellation_fee_base numeric` and `cancellation_fee_gst numeric`. `cancellation_fee` becomes the total.

**Helper `courier_cancel_fee_for(_order_id uuid)`**
- Returns `fee_base, fee_gst, fee_total, refund_amount, rider_share`.
- taxable = total_amount − gst_amount.
- percent: round(taxable × v/100, 2). flat: least(v, taxable).
- fee_gst = round(fee_base × gst_percent/100, 2).
- refund = greatest(total − fee_total, 0).
- rider_share = round(fee_base × share_pct/100, 2).
- Plan values come from the order's `fare_breakdown` snapshot when it's a business trip. Otherwise the global settings are used.
- Security definer. Execute is granted to service_role and postgres only.

**Functions rebuilt from their live definitions**
- `courier_cancel_order`: at ARRIVED_PICKUP, uses the helper. It saves base/gst/total, refund_amount goes to the card refund pipeline, and rider_share is credited to the rider.
- `business_reject_trip_internal`: the same change, credited to the rider as 'courier_cancel_fee:<id>'.
- `business_sync_from_order`: the wallet refund stays total − cancellation_fee. That already equals refund_amount, and I'll confirm it against the live code.
- `business_get_trip_otps`: only reads `cancellation_fee`. I'll check it and leave it unchanged unless it recomputes the fee.
- The booking functions that matched the search (`customer_cancel_booking_apply`, `system_auto_cancel_booking_no_expert`, `bookings_before_insert`) are for home-service bookings, not courier, so they're left alone.

**New `staff_set_cancel_fee(_type text, _value numeric, _rider_share_pct numeric)`**
- Super admin only (`business_require_super_admin`). It validates the inputs, upserts the three settings, and records a `business_audit` entry with before/after.

**Checks after applying**
- Read the changed definitions back, and check every call against its live signature.
- A rollback-only SQL check runs the helper on a ₹200 + 5% order and confirms 100 / 5 / 105 / 105 / 50, for both percent and flat (for example, flat ₹30 gives 30 / 1.5 / 31.5 / 178.5 / 15).
- Run the linter.
