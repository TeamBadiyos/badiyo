# Secure expert access to booking customer contact

## Confirmed current state
- `bookings` links the customer through `user_id` and the assigned expert through `assigned_expert_id`.
- Customer contact is stored in `users.full_name` and `users.phone`.
- `get_expert_id_for_auth(auth.uid())` already validates the signed-in expert identity and is executable by signed-in users.
- Bookings have `status` and `updated_at`, but no separate completion timestamp.
- An existing broad read policy lets assigned experts read the customer row for any assigned booking. This step will not remove or alter that policy, as requested.

## Migration
Create `public.expert_get_booking_customer(_booking_id uuid)` as a `SECURITY DEFINER`, stable SQL function with a fixed `search_path`.

The function will:
- Return a table containing only `full_name` and `phone`.
- Join the requested booking to its customer in `public.users`.
- Require `get_expert_id_for_auth(auth.uid()) = bookings.assigned_expert_id`.
- Return the row while the booking is not `completed` or `cancelled`.
- For a completed or cancelled booking, return it only until 24 hours after `bookings.updated_at`, which is the available terminal-state timestamp.
- Return no row for signed-out callers, unassigned experts, other experts, missing bookings, or terminal bookings older than 24 hours.

## Permissions and compatibility
- Remove default/public and anonymous execution access.
- Grant execution only to `authenticated` and `service_role`.
- Do not change tables, UI, existing functions, or existing policies.

## Verification
- Inspect the created function definition and grants.
- Verify anonymous access is denied.
- Verify an unrelated signed-in user receives no row where testable; authenticated assigned-expert runtime verification will be reported separately if no managed session is available for this external Supabase project.
