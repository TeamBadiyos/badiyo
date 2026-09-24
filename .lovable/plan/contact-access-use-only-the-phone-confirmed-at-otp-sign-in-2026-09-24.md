# Contact access: use only the phone confirmed at OTP sign-in

## What I found
- Sign-in doesn't use Supabase's built-in phone login, which is turned off. After a correct OTP, the sign-in service gives the account a sign-in email built from the number: `phone_91XXXXXXXXXX@badiyos.phone.local`, saved in **`auth.users.email`**.
- Only the server sets this email, and only after the OTP is checked. It's the real "confirmed number" for 67 of the 69 accounts.
- **`auth.users.phone`** is filled in for only 2 accounts, and both are marked confirmed (`phone_confirmed_at`, the time the number was confirmed).
- The current fallback, `public.users.phone`, is the profile number, and the customer can edit it from the app. That's the hole this fix closes.
- The copy of the number saved in the account details (`user_metadata.phone`) can also be changed from the app, so it won't be used.

## Can the customer change these values from the app?
- They can't write to the sign-in tables (`auth.users`) directly.
- The only way to change either value from the app is the built-in "update email/phone" request. That request only takes effect after the new email or number is confirmed.
- Phone login is off, so the phone can't be changed that way at all.
- The email only stays safe if Supabase's **"Confirm email" setting stays ON**. If it's off, a customer could switch their sign-in email to someone else's `phone_91…@badiyos.phone.local` address and see that person's parcel codes.
- I can't read that setting from here. Please check it under Authentication > Providers > Email, and also check that "Secure email change" is on. The fix below adds a second guard as well.

## Change (only `courier_my_phone10`)
1. Remove the profile-number fallback completely.
2. Use the number from the sign-in email, but only if it matches `phone_91` + 10 digits + `@badiyos.phone.local` and the email is marked confirmed (`email_confirmed_at` set).
3. Otherwise, use `auth.users.phone`, but only when `phone_confirmed_at` is set.
4. If neither applies, return nothing, so the customer gets no contact access.
5. The deleted-account check stays as it is.

## Not changed
- `courier_notify_stop_contact` is not changed: it still also matches on the profile number when choosing who gets the "Parcel update" alert. That alert never contains a code. Say if you want it limited to confirmed numbers too.
- Nothing else changes.
