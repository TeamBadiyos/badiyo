# Fix: "Database error checking email" after deleting an account

## What is happening

When someone deletes their account, we mark their old login as permanently blocked using a special "forever" value. The login service cannot read that value — it errors out. From then on, any attempt to look up or create a login (including a brand-new signup with the same phone number) fails with the red "Database error checking email" message on the OTP screen.

This is confirmed: two old logins currently hold that "forever" value, and the login service is returning a server error on every account lookup coming from the live app.

## The fix

1. Change the delete-account routine to block the old login with a fixed far-future date (year 2999) instead of the "forever" value. Same effect for the user, readable by the login service.
2. Repair the two existing broken logins by replacing their "forever" value with the same far-future date, so registration starts working again immediately.

No app screens change. Deleting an account keeps working exactly as before, and a deleted user can register again with the same phone number.

## Technical detail

- Root cause: `public.customer_delete_account()` sets `auth.users.banned_until = 'infinity'::timestamptz`. GoTrue scans that column into `*time.Time`; Postgres renders infinity as the string `infinity`, producing `sql: Scan error on column index 1, name "banned_until": unsupported Scan, storing driver.Value type string into type *time.Time` and a 500 on `POST /admin/users`.
- Migration: recreate `customer_delete_account()` with `banned_until = timestamptz '2999-01-01'`.
- Data repair: `UPDATE auth.users SET banned_until = timestamptz '2999-01-01' WHERE banned_until = 'infinity'` (2 rows).
- Verify afterwards: no rows remain with an infinite `banned_until`, and a fresh OTP signup completes.
