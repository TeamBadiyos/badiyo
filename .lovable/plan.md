# Drop proof follow-ups

## 1. First-delivery geofence (database change)
- In `courier_complete_drop_with_proof`, updated from its live definition:
  - **Receiver already has a verified location:** no change. The rider must be within `proof_geofence_m` (150 m).
  - **No verified location yet:** the rider must be within 1000 m of the receiver's map pin. Otherwise the drop is refused with OUTSIDE_GEOFENCE, the distance and the 1000 m limit.
  - **Inside 1000 m:** allow, flag `location_unverified`, and save the rider's GPS as the verified location.
- The 1000 m limit is stored as a new setting, `ops_settings.proof_first_delivery_radius_m = 1000`, so ops can change it later.
- If the receiver has no pin at all, the stop's own location is used.
- New `staff_reset_receiver_location(_receiver_id, _reason)`:
  - Only super_admin or ops_manager can use it (through the existing ops check), and a reason is required.
  - Clears `verified_lat`, `verified_lng` and `verified_at`.
  - Logs the old values in the audit log.

## 2. Endpoints and allowed origins
Published Customer App base URL:
- `https://user.badiyos.com/api/public/proof/upload-url` (POST)
- `https://user.badiyos.com/api/public/proof/download-urls` (POST)

The same paths also work on `https://badiyos.lovable.app`.

Only these origins are allowed, never `*`:
- `https://expert.badiyos.com`
- `https://merchant.badiyos.com`
- `https://badiyos.com` (Command Center)
- `https://user.badiyos.com`
- `https://localhost` (installed Android apps)
- `capacitor://localhost` (installed iOS apps)

How it works:
- **Shared helper `src/lib/proofCors.ts`:** echoes back only an allowed origin, allows `Authorization` and `Content-Type`, and allows POST and OPTIONS. It sends `Vary: Origin` and caches the preflight for 24 hours.
- **Both routes:**
  - Get an OPTIONS handler: 204 with the headers for an allowed origin, 403 otherwise.
  - Put the headers on every response, including errors.
- **Requests with no Origin header** (server-to-server or native HTTP) still work without CORS headers. The sign-in token remains the real security check.
- **The cleanup endpoint** stays job-only and gets no CORS headers.

## 3. Test script
I'll write the full rollback test as a new version (`drop_proof_rollback_test_v2.sql`) and paste all of it into the reply.
- The Demo Store stays fixed.
- It runs the existing cases, plus a new first-delivery case on drop 3 (receiver with no verified location):
  - Photo about 1.5 km from the pin: refused with OUTSIDE_GEOFENCE, and the limit reported is 1000.
  - Photo at the pin: completes, flagged `location_unverified`, receiver location saved.
- It also checks that `staff_reset_receiver_location` clears the saved location (ops caller simulated inside the transaction).
- Not run.

## Technical details
- One migration: the function redefined from its live definition, the new setting row, the new RPC, and permissions (revoked from anon; granted to authenticated and service_role).
- I'll confirm with a live definition read after applying.
