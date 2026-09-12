# Plan: Make email optional in Complete Profile popup

## What we will change
- Treat profile as complete once the user has entered their **name**.
- Keep the email field in the popup, but mark it as optional and allow saving with an empty or valid email.
- Update validation so an invalid email is rejected only when something is typed; blank email is accepted.
- When saving, update only the fields the user provided (name always; email only if non-empty, otherwise leave existing value or clear synthetic placeholder).
- Update the popup header/subtitle and the email input placeholder to communicate that email is optional.
- Update the component doc comment to reflect the new completion rule.

## Files to edit
- `src/components/CompleteProfileSheet.tsx`

## Technical details
1. Completion check (`nameOk && emailOk`) becomes `nameOk` only; popup reappears until name is saved.
2. `save()`:
   - Require non-empty `fullName`.
   - If `email` is non-empty, validate format; otherwise allow save.
   - Build the `update` payload dynamically: always include `full_name`; include `email` only when a valid email is provided (set to `null` when blank to clear any synthetic placeholder).
   - Continue to apply any typed referral code after the profile update succeeds.
3. UI copy: change subtitle to mention name is required and email is optional; change email placeholder to "Email address (optional)".
4. Remove the hard email-format error when the field is empty.

## Out of scope
- No database schema changes.
- No changes to referral flow or photo upload.
- No changes to where the popup is triggered.
