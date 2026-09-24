# Remove broad expert access to customer profiles

## Change
- Drop only the policy `Experts can view customer of assigned booking` from `public.users`.
- Keep `expert_get_booking_customer(uuid)` as the restricted replacement.
- Do not alter any other policy, function, table, permission, or application code.

## Verification
- Confirm the named policy no longer exists.
- Confirm all other `public.users` policies remain present.
- Confirm `expert_get_booking_customer(uuid)` still exists and remains executable by `authenticated` but not `anon`.
