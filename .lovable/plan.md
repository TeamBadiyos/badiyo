# Fix re-registration after account deletion

## Confirmed issue

For `+91 7559225570`, the deleted authentication user still exists and is blocked until 2999. Its main email was cleared, but its linked email identity still reserves `phone_917559225570@badiyos.phone.local`.

The OTP verifier searches only the main authentication email/phone and the active customer profile. Because deletion cleared all three, it concludes that no user exists and tries to create a new one. Supabase then rejects that creation because the linked identity already owns the same synthetic email, producing “A user with this email address has already been registered.”

## Fix

1. Update the internal email lookup to also resolve a user through the existing linked email identity.
2. When OTP verification finds a previously deleted user, safely reactivate that same authentication account instead of creating a duplicate:
   - remove the account ban;
   - restore its synthetic login email and new temporary password;
   - restore the customer profile with the phone number and clear its deletion marker.
3. Keep normal returning-user login unchanged and preserve the current two-device/PIN flow.
4. Add guarded handling for the email-collision case so a stale identity is recovered rather than shown directly to the customer.
5. Repair this affected account and verify:
   - only one authentication identity owns the phone login;
   - OTP verification can mint a session;
   - the customer profile becomes active again;
   - deleting and re-registering a test account works end to end.

## Technical details

- Database changes will be applied through a migration with security-definer helper functions restricted from anonymous direct use.
- The OTP function will use the service-role path to reactivate deleted accounts and will be redeployed after the database change.
- Existing bookings and financial history remain attached to the same user ID; no duplicate account or data migration is created.
