# Referral rewards: what's broken and how to fix it

I traced the whole referral journey — invite link, sign-up linking, and the reward payout — against the live database. Referral rewards are currently **never paid out**. The database shows 0 referral records, 0 users linked to a referrer, and 0 coins credited, across 12 users.

## The problems

**1. The reward is blocked by the order of two steps (main bug).**
After a payment succeeds, the app first moves the booking from "confirmed" to "accepted" (so an expert can be found), and only then asks the system to pay the referral reward. But the reward check only pays when the booking is still in "confirmed" state — by then it never is. So the reward silently does nothing, every single time. The same wrong order exists in the payment-recovery path.

**2. The "first booking" check ignores the real states.**
The reward only counts bookings in confirmed / expert assigned / in progress / completed. Real bookings sit in "accepted" and "pending" too, so a genuine first booking often counts as zero and the reward is skipped again.

**3. The recovery path can never pay a reward at all.**
When the booking is rebuilt from a payment (customer closed the app, webhook recovery), the payout is attempted with no signed-in user, and the reward function immediately gives up because it only works for the signed-in customer.

**4. The invite link points at a domain the app doesn't serve.**
The Refer & Earn screen shares `https://badiyo.in/invite/CODE`, but the app lives on `user.badiyos.com`. Anyone tapping a shared invite lands nowhere, so no referral is ever recorded. This matches the zero referral records in the database.

**5. Two users have no referral code.**
Codes are only generated when a user row is first created, so older/edge-case rows have none — their Refer & Earn screen shows a dash and their share is useless.

## Proposed fix

1. Pay the referral reward **before** the booking is auto-accepted, in both the normal payment path and the recovery path.
2. Widen the first-booking check to include "accepted" and "pending" so a real first booking is recognised.
3. Add a system version of the payout that works without a signed-in user, used by the recovery path; keep the existing signed-in path for the app.
4. Make the reward payout idempotent — safe if it runs twice, so no double coins.
5. Point invite links at the live app domain and make sure `/invite/CODE` captures the code and carries it through login.
6. Backfill referral codes for users missing one, and generate a code on read if it's still absent.

After the fix I'll run a full test: create an invite, sign up a second account with it, pay for a first booking, and confirm the referrer's coins, wallet entry, referral history row and notification all appear.

## Technical notes

- `PaymentScreen.tsx` calls `system_accept_booking_after_payment` (which flips `confirmed` → `accepted`) before `credit_referral_for_booking`, whose first guard is `IF _booking_status <> 'confirmed' THEN RETURN`. Same ordering inside `system_fulfill_payment_intent`.
- `credit_referral_for_booking` counts first bookings with `status IN ('confirmed','expert_assigned','in_progress','completed')` — add `accepted`, `pending`.
- Add `system_credit_referral_for_booking(_booking_id)` that resolves the customer from `bookings.user_id` instead of `auth.uid()`, and have `credit_referral_for_booking` validate ownership then delegate. Guard on `referral_transactions.status = 'pending'` plus a `booking_id IS NULL` check for idempotency.
- `ReferralDashboardScreen.tsx` hardcodes `https://badiyo.in/invite/${code}`; use the live origin (`user.badiyos.com`) instead, keeping `src/routes/invite.$code.tsx` as the landing route.
- Backfill: `UPDATE public.users SET referral_code = upper(substring(md5(id::text),1,6)) WHERE referral_code IS NULL`.

No changes to reward amounts (50 coins per referral, 5-referral / 100-coin milestone stay as configured).
