# Full audit and hardening pass

Note: this app is a React + Supabase + Capacitor web app (not Flutter), so the audit uses the TypeScript typechecker, a production build and the database linter instead of Dart tooling.

## What the first pass already shows

- Type checking passes with no errors today.
- No Project monitoring issues are pending; all realtime subscriptions are cleaned up properly (5 subscribes, 5 teardowns).
- The database security scan is where the real problems are: 241 linter issues, plus one open scanner finding.

Confirmed problems:

1. **Staff-only and system-only database actions can be called without signing in.** 23 privileged functions are executable by anonymous callers, including the ones that change dispatch settings, edit support tickets, save capacity messages, raise dispatch alerts and run the scheduled-reminder job. Anyone with the public key could invoke them.
2. **Expert/merchant unavailability schedules are world-readable.** The `availability_overrides` table allows anyone to read every unavailability window, reason and target ID.
3. **Four tables have protection switched on but no rules at all** (`otp_codes`, `otp_rate_limits`, `pin_login_lockouts`, `edge_runtime_config`). These are server-only, so the correct fix is explicit deny-by-default plus confirming no client role has table access.
4. **Leaked-password protection is off** in Supabase Auth.

## Plan

### 1. Lock down privileged database functions
Revoke public/anonymous execute rights on every `SECURITY DEFINER` function that is not meant to be called by the app:
- All trigger-only functions (`notify_*`, `bookings_*`, `experts_after_*`, `force_review_otp`, `reward_ledger_after_reversal`) — triggers do not need execute grants.
- All `staff_*` and `system_*` functions — restrict to the service role / staff-checked paths only.
- Internal dispatch helpers (`raise_dispatch_alert`, `evaluate_zone_capacity`, `check_booking_capacity`, `send_scheduled_booking_reminders`).
Functions the customer app genuinely calls while signed in (bookings, tips, rewards, referral, device, profile, OTP helpers) keep `authenticated` execute and are left untouched, so no existing flow breaks.

### 2. Fix the unavailability data leak
Replace the public read rule on `availability_overrides` with: staff can read everything, an expert/merchant can read their own rows. The customer app reads availability through existing security-definer helpers, so the UI keeps working.

### 3. Deny-by-default on the four unprotected tables
Add explicit no-access rules and confirm only the service role has table privileges, so server functions keep working and clients cannot reach OTP codes, rate limits or PIN lockouts.

### 4. Auth hardening
Turn on leaked-password protection.

### 5. Code-level recheck
Walk the recently changed areas end to end and fix anything broken found along the way, without redesigning them:
- Payment → booking recovery path (webhook, payment intents, retry UI).
- Live service screen: countdown, OTP sharing, tips, extension, banner.
- Complete-profile popup, referral apply, account delete/re-register.
- Home, tracking and rewards data loading: check for redundant fetches, missing loading/error states and unnecessary re-renders.

### 6. Verify
Run the typechecker, a production build and the database linter again, and re-scan security. Report before/after issue counts and a short list of what was found and fixed.

## Out of scope

No visual redesign, no change to pricing, GST, dispatch or reward rules unless a real bug is found in them.
