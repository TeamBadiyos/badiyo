# Business delivery accounts — backend only

No screens change. Existing stores and the Merchant App keep working exactly as today. One database change (migration), nothing in the app code.

## 1. Merchant modules
- New merchant fields: store_enabled (default on), delivery_enabled (default off), delivery_status (inactive / active / suspended, default inactive).
- Existing stores automatically get store on, delivery off — no behaviour change.
- The merchant can never change these three themselves (added to the existing protection check).
- merchant_my_context also returns the three fields; every existing field stays.

## 2. New tables (settings only, no batching yet)
- business_profiles — one per merchant: business name, GSTIN, city, default vehicle and courier type, batch capacity (10), auto-time batching (off, 120 min), auto-quantity batching (off, 10), low balance alert (500).
- business_pickup_points — name, address, location, contact, default flag (only one default per merchant), active flag.
- business_receivers — shop/receiver name, contact person, 10-digit phone (same check as courier), address, location, notes, active flag, "added by" label. One active receiver per phone per merchant. Saving is refused if the location is outside the courier service area.

## 3. Who can see / change
- Read: the owning merchant, its active staff, and ops staff. Nobody writes directly — only through the functions below.
- New staff permission "manage_delivery" (owner always has it).
- A gate check runs first in every merchant-side function: delivery must be on and active, and the caller must be the owner or staff with manage_delivery.

## 4. Merchant functions (each records "who did this")
Save receiver, turn receiver on/off, save pickup point (contact and location editable), get profile.

## 5. Command Center functions (ops staff only, every change in the audit log)
- Create business account from a phone number: finds or creates the merchant with store off, delivery on and active, plus its profile.
- Turn store / delivery modules on or off (at least one must stay on, reason required).
- Set delivery status (reason required).
- Save business profile, save pickup point.

## Technical details
- Before writing SQL: read current definitions of merchants_guard_privileged, merchant_my_context, merchant_ensure_draft, merchant_claim_staff_invite, current_merchant_id, merchant role permission storage, courier_check_serviceability / courier_validate_local_route, courier_is_ops_staff, audit_logs columns, and how merchants store the owner phone. Changes use CREATE OR REPLACE, keeping signatures and return fields.
- staff_create_business_account: normalize the phone to 10 digits. If a merchant exists for that phone, reuse it and enable delivery (store flag untouched). Otherwise insert a merchant row with no owner user yet and the phone stored, store_enabled=false.
- merchant_ensure_draft: before creating a new draft, look for an unclaimed merchant whose phone matches the caller's verified sign-in phone (same verified source as courier_my_phone10); if found, attach the caller as owner and return it. Existing owners are unchanged. merchant_claim_staff_invite unchanged unless it also creates drafts.
- Unique partial indexes: one default pickup point per merchant; (merchant_id, contact_phone) where active.
- Tables: GRANT SELECT to authenticated, ALL to service_role; RLS on; select-only policies. RPCs SECURITY DEFINER, fixed search_path, execute revoked from anon, granted to authenticated.
- updated_at triggers on all three tables.
- Reply will list everything created/changed and confirm how merchant_ensure_draft behaves for a pre-created phone.
