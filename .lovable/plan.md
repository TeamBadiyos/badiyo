# "Complete your profile" popup should keep coming back

## What happens today

- The popup checks the profile only once, the first time the home screen loads after the app starts.
- Tapping "Skip for now" writes a flag into the browser session. In the installed app the page is never really closed, so that flag survives closing and reopening the app — the popup then stops appearing even though the profile is still incomplete.
- Signing out and signing in with another number in the same run also does not re-trigger the check.

## What it should do

- If name or email is still missing, the popup appears again every time the customer comes back to the app (fresh open, or returning after the app was in the background for a while).
- "Skip for now" only hides it for the current visit.
- Once name and email are saved, it never appears again.
- It still stays out of the way during login, OTP, PIN and booking flows.

## Changes

- Drop the stored "dismissed" flag and keep the skip in memory only, so it resets on the next app open.
- Re-run the profile check when the app returns to the foreground (app resume / tab becomes visible again) and when a different user signs in, instead of only once per page load.
- Keep the popup limited to the home, orders and rewards screens.

## Technical notes

- `src/components/CompleteProfileSheet.tsx`: remove `sessionStorage` `DISMISS_KEY` usage; replace the one-shot `checkedRef` with a check keyed on the current user id that re-runs on `enabled`, on Capacitor `App` `resume` / `visibilitychange` (only after the app was hidden), and on Supabase `onAuthStateChange` sign-in. Skip state becomes component state reset by those same triggers.
- No database or server changes; profile completeness stays defined as non-empty `full_name` plus a real (non `@badiyos.phone.local`) `email`.
