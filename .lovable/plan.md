# App health check: notifications and follow-up fixes

I went through the whole booking journey in the database and the app code. Most alerts do fire, but there are four real problems and a few genuinely missing alerts.

## What already works

- Booking confirmed, expert assigned, service started, service completed, booking cancelled
- 10-minutes-left reminder (runs every minute)
- Extension approved / declined
- Support ticket resolved
- Expert side: new job broadcast, job assigned, extension requested, job ending soon, job completed

## Problems found

1. **Duplicate alerts.** Expert assigned, service started and service completed are each sent twice — once by the booking status trigger and once by the action that changed the status. Customers get two identical pop-ups for the same event.
2. **Tapping an alert opens the wrong screen.** Any booking alert opens the "Expert assigned" screen, even when the service is already running or finished. It should open the screen that matches the booking's real state (running service, or rate-and-review).
3. **The old "service started" alert has no alert type.** Because of that the phone treats it as an ordinary message, and the two started-alerts behave inconsistently.
4. **Only Android phones are registered for alerts** (19 devices, no web ones). Worth confirming the browser version is registering, otherwise nobody using the web app gets anything.

## Alerts that are missing

- Payment received / booking placed confirmation
- Scheduled bookings: no reminder before the chosen slot (e.g. the evening before and an hour before)
- No alert when no expert could be found and the booking is auto-cancelled or still searching after a few minutes
- Extension request awaiting the expert's answer — the customer gets nothing until the expert decides
- Expert gets no alert when a customer leaves a tip
- No alert when a reward, referral bonus or wallet credit lands

## Other things worth fixing

- Tips are recorded from the phone with a payment reference that is never verified against Razorpay, so a tip could be recorded without a real payment. Should be verified server-side.
- The extension price still comes from the old fixed-duration price list, so extensions fail for services that aren't 60/120/180 minutes.
- The "Refer & Earn" banner on the live-service screen is still switched off in the command centre.

## Proposed work

**Step 1 — fix the four problems**
- Remove the duplicated sends so each event notifies once, with a proper alert type.
- Make alert taps open the correct screen based on booking status.
- Confirm/repair web alert registration.

**Step 2 — add the missing alerts**
- Booking placed, scheduled-slot reminders (a cron job for these), still-searching / no-expert-found, extension pending, tip received (expert), reward and wallet credits.

**Step 3 — the extras**
- Verify tip payments server-side before crediting.
- Let extensions price from the real service catalogue.
- Turn on and fill in the live-service banner.

## Technical notes

- Duplicates: `claim_booking_as_expert` / `staff_assign_expert` call `notify_customer_push` while `trg_notify_customer_status_change` also fires for `expert_assigned`; same for `expert_verify_start_otp` (in_progress) and `expert_verify_end_otp` (order_completed). Keep the trigger as the single source and drop the inline `notify_customer_push` calls, moving the richer copy into the trigger.
- Deep links: `src/routes/index.tsx` maps any `booking/<id>` route to phase `expert-assigned`; select the phase from the booking's status (`expert_assigned`, `in_progress`, `completed` → review).
- `notify_customer_push` has no `alert_type`, so the native alarm path (`order_completed`, `reminder_10min`, `extension_decided`) can't classify it; migrate remaining callers to `notify_customer_alert`.
- New scheduled-slot reminders: cron job similar to `send_completion_reminders`, with a `reminder_sent`-style guard column to avoid repeats.
- Also verify the `send-push-notification` edge function is deployed and reachable — it isn't in this repo and shows no recent invocations.

Tell me which steps to do; I'd start with Step 1.
