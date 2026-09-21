# Notifications: finish the Firebase key fix (Option B) and repair alerts

You have saved a fresh Firebase service account in Supabase as `FIREBASE_SERVICE_ACCOUNT_JSON`. Next step is to confirm the push sender actually picks it up, then fix the alert problems we found.

## Step 1 — Confirm pushes now go out

- Send a test push through the existing push sender and read the response.
- Expected before the fix: `sent: 0, failed: 2, invalid_grant`. Expected after: `sent > 0`.
- If it still fails with `invalid_grant`, the likely cause is a **name mismatch**: the deployed sender may read a differently named secret (for example `FIREBASE_SERVICE_ACCOUNT`). In that case we save the same JSON under the name the sender expects and re-test. No code change needed.
- Also confirm one real phone receives it (your own login token is fresh in the database).

## Step 2 — Stop duplicate alerts

Expert assigned, service started and service completed are each sent twice today — once by the booking-status rule and once by the action itself. Keep one sender (the status rule) and move the better wording into it, so the customer gets exactly one alert per event.

## Step 3 — Tapping an alert opens the right screen

Right now every booking alert opens the "Expert assigned" screen. It should open the screen that matches the booking's real state: searching, expert assigned, service running, or rate-and-review after completion.

## Step 4 — Give every alert a proper type

Some older alerts are sent without an alert type, so the phone treats them as plain messages and the full-screen alarm never triggers. Move the remaining senders to the typed alert path.

## Not in this plan (can follow later)

Missing alerts (payment received, scheduled-slot reminders, no-expert-found, extension pending, tip received, wallet/reward credits) — worth doing next, but only after delivery is proven working.

## Technical notes

- Test target: `POST https://dkneclwmmjlqswovtqno.supabase.co/functions/v1/send-push-notification` with header `x-internal-secret` (value stored in `edge_runtime_config.push_trigger_secret`).
- The edge function source is not in this repo, so only its secret and its response can be changed/read from here; if the secret name is wrong we duplicate the value under the expected name rather than editing the function.
- Duplicates: drop the inline `notify_customer_push` calls in `claim_booking_as_expert`, `staff_assign_expert`, `expert_verify_start_otp`, `expert_verify_end_otp`; keep `trg_notify_customer_status_change` as the single source, using `notify_customer_alert` (carries `alert_type`).
- Tap routing: `src/routes/index.tsx` maps any `booking/<id>` deep link to phase `expert-assigned`; select the phase from the booking's status instead.
- Verification: `bunx tsgo --noEmit` plus a live push test before reporting done.
