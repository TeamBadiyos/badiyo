# Drop proof for business trips (backend only)

No app screens change. Normal customer parcel orders keep using OTP exactly as today. Every change to an existing function is made from its current live definition, not rewritten from memory.

## Step 0: Check the live database first
Before writing anything, read the live definitions of: business_profiles, business_receivers, business_trip_packets, courier_orders, courier_order_stops, courier_verify_stop_otp, courier_rider_arrive_stop, courier_trip_packets, business_audit, the app settings table, existing storage buckets, and how scheduled jobs run today (pg_cron, pg_net, courier_sweeper_tick).

## 1. Settings
- business_profiles: drop_proof_mode ('otp' / 'bill_photo' / 'otp_or_photo', default 'otp') and proof_retention_days (default 180). Existing businesses stay on 'otp'.
- Global setting proof_geofence_m = 150, stored in the existing settings table.
- Staff action to change both per business. Only super_admin and ops_manager can use it, and every change is audited.

## 2. Photo storage
- New private bucket "delivery-proofs". File path: merchant/date/stop/n.jpg.
- No public access, and the app cannot upload directly. Uploads only go through short-lived signed links.

## 3. Proof records
- New table business_delivery_proofs with the fields listed in the brief.
- courier_order_stops.completed_via records whether a stop was completed by 'otp' or 'photo'.
- business_receivers gets verified_lat, verified_lng and verified_at, added only if they are missing.
- Who can read proofs: the business's members, staff, and the assigned rider (own rows only). Nobody writes to this table from the app.

## 4. Upload link (proof-upload-url)
Checks before giving a link:
- The caller is the assigned rider.
- The trip's mode allows photos.
- The stop is an active drop stop on that trip.
- All of that stop's packets are scanned at drop.
- The stop has fewer than 5 photos.
It returns a signed upload link and path, valid for about 5 minutes.

## 5. Complete a drop with photos
courier_complete_drop_with_proof checks:
- The caller is the assigned rider.
- There are 1 to 5 photos, and each one really exists in that stop's folder.
- All packets at the stop are scanned.
- The rider is inside the geofence. It uses the receiver's verified location if there is one, otherwise the pin. If the rider is outside, it refuses with OUTSIDE_GEOFENCE and the distance.
- On a receiver's first delivery with no verified location: allow it, flag it as location_unverified, and save the rider's GPS as the verified location.
- If the mode is 'otp', it refuses with MODE_OTP.

The stop is then completed through the same internal path a successful OTP uses (same statuses, events and settlement). It also saves the proof rows, an event entry and an audit entry.

## 6. OTP for business trips
- Modes 'otp' and 'otp_or_photo': OTP works as today and records completed_via = 'otp'.
- Mode 'bill_photo': OTP is refused with PHOTO_REQUIRED.
- A stop that is already completed cannot be completed again either way.

## 7. Rider trip data
courier_trip_packets adds drop_proof_mode for each stop plus any existing proofs.

## 8. Reading proofs
- business_stop_proofs and business_order_proofs return proof rows and completed_via.
- business_proof_report returns delivered stops for a date range, with an optional receiver filter, in pages.
- Server actions return short-lived download links: per stop or order, and in bulk (up to 300) for ZIP download. Only business members and staff can use them.

## 9. Automatic cleanup
- Once a day, delete proof photos and rows older than each business's retention period.
- If pg_cron is available, it will run on a schedule. Otherwise it uses the existing sweeper-plus-wake pattern with a secret-protected job endpoint. The reply will say which one was used.

## 10. Test script (not run)
- Fixed to the Demo Store. Moves the order through valid statuses using the real rider actions.
- Covers the cases in the brief:
  - 'bill_photo': OTP refused, photo completes.
  - 'otp': photo refused.
  - 'otp_or_photo': OTP completes one stop, photo completes another, and a second completion of the same stop is refused.
  - Photo before all packets are scanned: refused.
  - Outside the geofence: refused.
- Photo files are simulated as rows in the storage table, inside the rolled-back transaction.
- Ends with 'TEST OK (rolled back)'.

## Technical details
- **Change from the brief:** "edge functions" become TanStack server routes, under src/routes/api/public/proof/*, verified by the rider's bearer token (project rule: no new Supabase Edge Functions). Only these routes use the service role, to sign upload and download links. SQL checks eligibility through a SECURITY DEFINER helper, `business_proof_upload_check(_stop_id)`, so the rules live in one place.
- Distance is haversine in meters. Paths are checked in storage.objects where bucket_id = 'delivery-proofs' and the name starts with the stop's folder prefix.
- New table: GRANT SELECT to authenticated and ALL to service_role, RLS on, select-only policies. New functions: SECURITY DEFINER with a fixed search_path; anon cannot run them. Cleanup and helper functions run only on the server (service_role).
- Storage policies: no insert, update or delete for authenticated users. Signed uploads use signed tokens.
- The reply will list every function, table, route and setting created or changed.
