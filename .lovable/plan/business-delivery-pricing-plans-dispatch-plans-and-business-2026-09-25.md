# Business delivery: pricing plans, dispatch plans and business orders

This is backend only, with no screens. It's one new database change. Existing shops, courier orders, wallets and the Merchant App keep working as they do today.

## What gets added

1. **Pricing plans:** name (unique), base fare, included km, per km, minimum fare, extra drop fee, return per km, and commission % (0–100). Every number must be 0 or more. Plans can be switched on or off but never deleted.
2. **Dispatch plans:** name (unique), and three ways to start a batch: manual, by order count (threshold of 1 or more), and at fixed times (India time, sorted, no duplicates). It also sets max drops per batch (1–50) and can be switched on or off. At least one way to start a batch must be on. The order count needs a threshold when it's on, and fixed times need at least one time when they're on.
3. **Business profile:** each business gets an optional pricing plan and dispatch plan. The older batching settings stay stored, but nothing reads them any more. That includes the business profile reply, which will stop returning them.
4. **Command Center actions** (ops staff only, every change written to the audit log):
   - create or edit a pricing plan
   - create or edit a dispatch plan
   - switch a plan on or off. Switching off is refused while an active business uses the plan, and the reply says how many businesses use it.
   - assign plans to a business (only active plans can be assigned)
   - list all plans, each with a "used by" count
   - Only ops staff can see plans.
5. **Business profile reply:** it now also includes the business's own assigned plan names and its pricing numbers, but never other plans. The commission % is not shared with the business.
6. **Business orders:** receiver, pickup point, invoice no. (optional), description, packet count (1–50, default 1), and status (pending / batched / in transit / delivered / returned / failed / cancelled). It also stores links for the coming batching step, who created the order, the cancel reason, and timestamps. The owning business, its staff with delivery permission, and ops staff can see them. Nobody can write to them directly from the app.
7. **Business actions** (delivery access checked first; "who did this" saved and logged):
   - **create order:** the receiver and pickup point must be active and belong to this business. Pickup defaults to the business's default pickup point. A second pending order with the same receiver and the same invoice no. is refused.
   - **create orders in bulk:** each row gets the same checks. It's all or nothing: if any row fails, nothing is saved, and every row error is reported with its row number. On success, the new order ids come back.
   - **cancel order:** only while pending, with no charge.
   - Orders stay "pending" for now. Batching and wallet charges come in the next phase.

## Technical details

- Tables: `bulk_pricing_plans`, `bulk_dispatch_plans`, `business_orders`. Each gets GRANT select to authenticated and all to service_role, RLS enabled, select policies only, and updated_at triggers via the existing touch function. Checks: numbers >= 0; commission between 0 and 100; dispatch rules checked in a trigger that also sorts and removes duplicate `slot_times`.
- `business_profiles.pricing_plan_id` and `dispatch_plan_id` are nullable foreign keys to the plan tables.
- Index `business_orders(merchant_id, status, created_at desc)`. A unique partial index on `(merchant_id, receiver_id, lower(btrim(reference_no)))` where status='pending' and reference_no is not blank.
- RPCs (SECURITY DEFINER, fixed search_path, anon revoked, authenticated granted):
  - `staff_upsert_pricing_plan`, `staff_upsert_dispatch_plan`, `staff_set_plan_active(_kind, _id, _active, _reason)`, `staff_assign_business_plans`, `staff_list_bulk_plans`. All use `business_require_ops()` plus `business_audit(...)`.
  - `business_create_order`, `business_create_orders_bulk`, `business_cancel_order`. All use `business_require_delivery()` plus `business_audit`.
  - Bulk errors are collected per row, and the whole batch is rolled back with a block that catches errors.
- `business_get_profile` is rewritten to drop the old batching fields and add `pricing_plan` {name, base_fare, included_km, per_km, min_fare, extra_drop_fee, return_per_km} and `dispatch_plan` {name, modes, slot_times, max_drops_per_batch}.
- `staff_upsert_business_profile` keeps its current parameters so nothing breaks. The old batching values it accepts are still saved but are not used.
- After the change, I'll send a list of everything created. Security scan warnings for "signed-in users can call these functions" are expected, because each function checks who is calling.
