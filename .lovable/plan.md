# Remove the contact picker from the app

The "From contacts" feature is removed entirely. Name and mobile number are typed manually on Send Parcel — exactly as the other fields work today. Nothing else about parcel booking changes.

## What changes for you

- The "From contacts" button disappears from both Pickup contact and Drop contact blocks.
- No contacts permission is ever asked again; the contacts add-on is removed from the project, so future Android builds won't carry it or the READ_CONTACTS permission note.
- Contact name and 10-digit number fields stay, with the same validation as now.

## Technical notes

- `src/components/courier/CourierBookingScreen.tsx`: remove the picker import, `canPick` state, `pickContact` handler, and the button; `ContactFields` keeps only the name + phone inputs.
- Delete `src/lib/contactPicker.ts` (no other file references it — verified).
- `src/i18n/en.ts` + `src/i18n/mr.ts`: remove `courier.contactNoNumber`, `courier.contactDenied`, `courier.contactUnsupported`, `courier.contactFailed` (keep `courier.contactName` / phone labels).
- `package.json`: remove the `@capacitor-community/contacts` dependency.
- `native/android/MANUAL_MERGE.md`: remove the whole "Contacts picker" section including the READ_CONTACTS manifest step.
- No pricing, payment, order, or database change. Typecheck + build verified after the edit.
