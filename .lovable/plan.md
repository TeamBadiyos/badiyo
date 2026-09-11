# Rewards system check — findings and fix plan

I checked the rewards screens, the database rules, the automatic crediting, and the live data.

## What is working

- Reward offers created in the command centre reach the customer Rewards screen and the expert side.
- Completion of a job automatically checks offers for both customer and expert, and credits them once only (no duplicates).
- Referral: invite code entry, self-referral block, duplicate block, and the "friend's first completed booking" payout all exist. Two invites are currently waiting for the friend's first booking — that is correct behaviour, not a bug.
- Daily job that grants weekly/monthly target offers is scheduled and running (1:15 AM daily).
- Reward notifications are sent to customer and expert when a reward is credited.
- Visibility rules are correct: each person only sees their own rewards.

## Problems found (worth fixing)

1. **Ratings are being lost, so any "rating" reward never pays out.**
   When the expert closes the job with the end OTP, the job is already marked complete. The customer's rating screen then tries to save and is rejected, silently. Live data: 13 completed jobs, only 1 has a rating.

2. **Cash rewards are counted as coins, and counted twice on screen.**
   A cash reward is added to the customer's coin total *and* recorded as a wallet entry. The Rewards screen then adds "coins from rewards" on top of that same total, so the number shown can be inflated.

3. **A cancelled/reversed reward does not take the coins back.**
   There is already one reversed reward in the data where the customer kept the coins.

4. **Progress bars for "complete N bookings" offers always show 0.**
   The screen does not count the customer's completed bookings for that offer period.

5. **The only active offer is a test entry** named "offer fdgfdg fghfhgf…" (₹10 on any booking above ₹1). Real customers see this. It should be renamed or switched off.

## Fixes I will make

1. Allow the rating to be saved after the job is completed (rating window after completion), keep the existing checks, and show the customer an error instead of failing silently. Rating-based rewards then fire as intended.
2. Keep coins and cash separate: cash rewards go to the wallet balance only, coins to the coin total. Rewards screen shows one correct total per type with no double counting.
3. When a reward is reversed, deduct the same amount back from the coin/wallet total and record a matching wallet entry.
4. Show real progress for "complete N bookings" offers by counting the customer's completed bookings in the offer window.
5. Flag the test offer to you — I will not delete it without your say-so; you can rename or deactivate it in the command centre.

## Technical notes

- `submit_booking_review` currently requires `status = 'in_progress'`; it will accept `completed` bookings too (rating only, no status change), still owner-checked.
- `reward_apply_credit`: split customer `cash` (wallet_transactions only) from `coins` (users.total_coins_earned); add a reversal path that reverses both.
- `src/lib/rewards.ts`: stop summing `legacyReferralCoins` with reward coins; add completed-booking count for `count_threshold` progress.
- `run_reward_period_jobs` customer branch uses `bookings.updated_at`; switch to `service_end_at` fallback `updated_at` for a correct period window.
- No changes to referral crediting logic, RLS, or grants — those check out.
