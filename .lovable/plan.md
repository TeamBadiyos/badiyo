# Send Parcel — contact picker, weight format, bike inclusions

Three focused improvements to the Send Parcel flow. No pricing, payment, dispatch or database rule changes.

## 1. Pick contact from phone contacts

On both **Pickup contact** and **Drop contact**, add a contact-book button next to the name/phone fields.

- Tapping it opens the phone's contact list and fills name + 10-digit mobile automatically.
- If permission has not been granted, the permission request is shown only at that moment (on tap), never at screen load.
- If the user denies permission, or the device/browser does not support picking, a short message appears and typing manually keeps working exactly as today.
- Picked numbers are cleaned automatically (spaces, +91, dashes removed) so only the 10-digit mobile is stored.

## 2. Weight shown with 2 decimals

- Weight field displays as `1.00 kg` style (two decimals) once the user finishes typing.
- While typing, free entry is allowed; formatting is applied on blur and when moving to the next step.
- The review screen and the value sent to the server also use the same 2-decimal value.

## 3. Inclusions and exclusions on the bike step

- Each vehicle card on the "Choose ride" step shows its own what's-included and what's-not list, per vehicle.
- The content comes from the vehicle setup already stored in Command Center (inclusions / exclusions per vehicle type), so adding a new vehicle later needs no code change.
- Included items show with a green tick, excluded with a red cross, in a compact list under the weight line.
- If a vehicle has no lists configured, that section is simply hidden.
- Restricted-items warning on the parcel step stays as-is.

## Technical notes

- Contacts: use `@capacitor-community/contacts` on Android (permission requested on tap), and the browser `navigator.contacts` Contact Picker API when available on web; otherwise fall back to manual entry. The native plugin needs to be added to the Android build — steps will be appended to `native/android/MANUAL_MERGE.md` (plugin install, `READ_CONTACTS` permission in `AndroidManifest.xml`, Capacitor-matching version).
- Files touched: `src/components/courier/CourierBookingScreen.tsx` (contact button, weight formatting, inclusion/exclusion rendering), a small `src/lib/contactPicker.ts` helper, `src/i18n/en.ts` + `src/i18n/mr.ts` for new labels, `native/android/MANUAL_MERGE.md`.
- `courier_vehicle_types.inclusions` / `.exclusions` are already fetched in `courierData.ts`; no schema or query change needed.
- Quote/create payload keeps its existing shape; only the weight value is normalised to 2 decimals.
