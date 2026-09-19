# "Picking contacts is not available here"

## Why it appears

The contacts feature needs a small device add-on that has to be part of the installed app. Right now it is only written up as a manual step for whoever builds the Android app — it is not part of the project, so the app you are testing has no way to open the phonebook and shows that message. On a desktop browser the phonebook simply does not exist, so the message is correct there but shouldn't be shown as an error at all.

## The fix

1. **Make the contacts add-on part of the project** so the next Android build automatically includes it, along with the contacts permission. After that build, tapping "From contacts" opens the real phonebook and asks for permission the first time.

2. **Hide the "From contacts" button when the device cannot offer it** (desktop browser, or an older installed app without the add-on) instead of showing an error. The name and number fields still work exactly as now, so nothing is blocked.

3. **Keep the friendly messages only for real situations** — permission refused, or the chosen contact has no number.

## What you still need to do

The change makes the next Android build include contacts. The currently installed app on your phone will keep hiding the button until you install a new build.

## Technical notes

- Add `@capacitor-community/contacts` (Capacitor 8 compatible) as a project dependency and add `READ_CONTACTS` to the Android manifest template under `native/android/`, so `npx cap sync android` wires it up; trim the now-redundant manual step in `MANUAL_MERGE.md` to a short note.
- `src/components/courier/CourierBookingScreen.tsx`: render the "From contacts" button only when `contactPickerAvailable()` is true (evaluated once on mount), and drop the `contactUnsupported` toast path.
- No change to pricing, payment, order creation, or any database rule.
