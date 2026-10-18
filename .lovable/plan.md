# Spin & Win prizes + sign-in code limits

Both parts were built in the previous step. This plan checks them again and fixes any gaps.

## 1. Spin & Win prizes in Rewards → Deals
Already in place:
- A list of prizes from app_my_spin_prizes(), showing the name in English or Marathi, the status, the "collect by" time, a QR and the code.
- "won": swipe to redeem calls app_spin_prize_redeem(_draw_id). Then a 5-second Undo button calls app_spin_prize_undo(_draw_id).
- Redeemed screen: big green tick with soft pulsing rings, the prize, the customer's name, the masked phone, a live HH:mm:ss IST clock, and the QR and code for staff.
- "redeemed" shows a Collected badge. "expired" shows the card greyed out.

Checks and polish:
- Make the tick and rings use the green success colour instead of the general theme colour.
- Make the clock show HH:mm:ss in IST.
- Make the Undo countdown start from the server's undo deadline.
- Make sure the list refreshes after redeem and after undo.

## 2. Sign-in code (send-otp) limits
Already in place:
- 3 sends per phone every 10 minutes (unchanged).
- 300 per network per hour normally.
- 2,000 per network per hour during the event window. The window's start and end come from Command Center settings (otp_event_mode_start / otp_event_mode_end), with backup secrets OTP_EVENT_MODE_START / OTP_EVENT_MODE_END.
- A safety cap of 3,000 codes per hour across everyone. When it is hit, the block is logged, Command Center gets an alert (at most one per hour), and the customer sees a clear "try again in a few minutes" message.

Remaining:
- Push the updated code sender live and send one test login code.
- Confirm the alert function exists and the settings rows can be edited in Command Center.

## Technical details
- Files: src/components/spin/SpinPrizes.tsx, src/lib/spin.ts, supabase/functions/send-otp/index.ts.
- Check otp_global_cap_alert and the ops_settings keys with read-only queries.
