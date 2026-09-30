# Booking tracking UI for the new Expert steps

Only screen changes. No new tables or functions, and no rows are deleted.

## 1. Message after booking a later slot
- On the "booking confirmed" / searching screen, for a scheduled booking whose slot is more than 60 minutes away, show:
  "Booking confirmed ✅. Expert ki details 4:00 PM tak aa jayengi."
- The time is slot start minus 60 minutes, worked out in IST (e.g. a 5–6 PM slot shows 4:00 PM). Add "Kal" or the date if the slot is not today.
- Keep the current "searching for expert" animation for ASAP bookings and for slots already inside the 60-minute window.

## 2. Five tracking steps
- Step bar: Expert assigned → Nikal gayi → Pahunch gayi → Service chalu → Poora.
- Status mapping: expert_assigned → 1, on_the_way → 2, arrived → 3, in_progress → 4, completed → 5. Older bookings that skip on_the_way/arrived still show the right step.
- **Nikal gayi:** live map showing the Expert's pin and the customer's address. It refreshes every 15 seconds and shows the Expert's name, photo and a Call button. If her location is missing or out of date, show "Location update ho rahi hai…" in place of the map. No location is shown in "Expert assigned" (privacy).

## 3. Pahunch gayi
- Show the start OTP large and in the middle of the screen, with the heading "Ye OTP Expert ko batayein". The Expert's name and Call button stay visible. No map.
- In "Expert assigned" and "Nikal gayi", the OTP shows smaller, like today.

## 4. Slot picker check
- Checked in code: the slot picker already starts at 10:00–11:00 AM and ends at 6:00–7:00 PM. No change needed. I'll confirm it on screen after the build.

## Technical details
- `StageTracker.tsx`: switch to 5 stages with the new labels. Replace the on_the_way/arrived → expert_assigned fall-through.
- `ExpertAssignedScreen.tsx`: branch on status. on_the_way → new `ExpertLiveMap` built from the existing `CourierLiveMap` pattern. It polls `booking_get_expert_location` with react-query `refetchInterval: 15000`, only while the status is on_the_way. arrived → big OTP block. `tel:` button uses the expert's phone.
- `SearchingForExpertScreen.tsx`: add a held-for-lead-window message using `slot_start_ist` logic (reuse the `hourSlots.ts` parser) and the 60-minute lead.
- i18n keys in en/mr for the new labels.
- Check: type check, then a Playwright check of the slot picker. Signed-in tracking screens can't be run here because there's no login session in this environment.
