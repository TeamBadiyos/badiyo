# Complete-profile popup + manual referral code

## What the customer will see

1. **After signing in**, if their name, email or photo is missing, a sheet slides up:
   "Complete your profile" — name, email, and an optional photo, plus an optional
   "Have an invite code?" box.
   - If they arrived through an invite link, the code is already filled in and marked as applied.
   - They can tap "Skip for now"; the sheet shows again on the next app open until name and email are filled.
2. **On the Refer & Earn page**, a new "Enter a friend's code" field lets existing customers
   apply a code they didn't get through a link (only if they haven't been referred yet).

## Behaviour

- Popup appears once per app session, after login/PIN unlock, never on top of the OTP, PIN or booking flow.
- Name and email are required to count as complete; photo is optional.
- Invite code is validated on save: unknown code or own code shows an inline error, the profile still saves.
- A code can only be applied while the account has no referrer yet; after that the field is hidden and shows
  "Invite applied".

## Technical notes

- New `CompleteProfileSheet` component (shadcn Sheet/Dialog) rendered from `src/routes/index.tsx`,
  gated on a `useQuery` of the current `users` row (`full_name`, `email`, `avatar_url`) plus a
  per-session dismissal flag in `sessionStorage`. Synthetic `@badiyos.phone.local` emails count as empty.
- Save path reuses the existing `users` update and the avatar upload logic already in
  `EditProfileScreen` (extracted into a small shared helper so both screens use one implementation).
- Referral apply calls the existing `link_referral` RPC via `src/lib/referrals.ts`; add an
  `applyReferralCode(code)` helper that surfaces the server error instead of only logging it.
  Prefill comes from `getStoredReferralCode()`; on success clear stored code.
- `link_referral` currently returns void, so the client can't tell "invalid code" from "already referred".
  Add a migration replacing it with a version returning a small status text
  (`applied` / `invalid_code` / `self_referral` / `already_referred`), keeping the same name, arguments
  and one-time semantics so existing callers keep working.
- Refer & Earn (`ReferralDashboardScreen.tsx`) gains the same input, hidden when `referred_by` is set.
