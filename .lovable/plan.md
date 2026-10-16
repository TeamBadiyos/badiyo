# Clean booking navigation fix + cleanup

## What the user will see
- Home Maid → 2 Hours → time → Continue opens Checkout straight away (no Home flash).
- Back from Checkout returns to the Booking page with the same option, day and time selected. Back again returns to the Clean tab. Next back on Home shows "Press back again to exit".
- A good saved address skips the address step. "Change address" on Booking or Checkout opens the address picker as a sheet on top and closes back to the same screen.
- Android back and the on-screen ← do the same thing everywhere.

## Causes found
- `CleanTab` closes the Booking page first, then the parent awaits a sign-in check, an address lookup and a serviceability check before switching to Checkout. During that wait Home is visible (the flash).
- The Booking page lives inside `CleanTab` local state, so once Checkout opens it is gone; Checkout's back is hard-wired to the old `address` phase, whose back goes to the old `slot` page (old "2 hours / Book now / Schedule" screen), then Home.

## Steps
1. **Lift the booking draft** (service key, option, day, time) to the route shell, stored as a "booking" state that CleanTab reads to reopen the Booking page on mount.
2. **Continue → Checkout directly**: run sign-in + address/serviceability checks while the Booking page stays visible (button shows a spinner), then switch straight to `summary`. Only if the address is missing/not serviceable open the address sheet over the Booking page.
3. **Checkout back** → Home phase with the Booking page reopened from the saved draft. Booking back → clears draft → Clean tab. Same handler for hardware back (via `useBackHandler`) and ←.
4. **Address as a sheet**: wrap the existing address picker in a bottom sheet used by Booking and Checkout; selecting returns to the same screen and updates the address. Not pushed to history.
5. **Cleanup (Clean flow only)**, after confirming no other references with search:
   - Remove the Clean path through `slot` (SlotSelectionScreen) and `address` phases, `onQuickBook`, old service detail pages, old Instant/Schedule sheets, old 6-tile section, any `app_clean_media` code, now-unused clean translations and bundled clean images (`clean-*.jpg`, `expert-*.jpg`, `wash-*.jpg`) if unreferenced.
   - Old phases/deep links that pointed at these (e.g. a booking re-entry from Orders "Book again", search results) redirect to the new Booking page or the Clean tab.
   - Kept: anything Store, Food, Parcel, Rewards, Profile, Orders, tracking, reschedule or payment still imports. Anything with unclear use is listed in the report instead of deleted.
6. **Lighter app**: lazy-load each tab body and heavy screens (Courier, Store screens, Orders, Profile sub-screens, tracking, Payment, Rewards/Contest/Deals) with the splash covering the first load; remove unused packages found by import search; convert remaining bundled JPGs to compressed WebP.
7. **Report**: deleted list, kept list with reasons, unsure list, and production bundle size before vs after (measured with a build into /tmp).

## Verification
Phone-size browser test with a signed-in session: Home Maid → 2 Hours → time → Continue → Checkout (screenshot right after tap shows no Home) → back (Booking, same selection) → back (Clean tab). Repeat with the hardware back path, and with "Change address" from both screens.

## Technical notes
- Files mainly: `src/routes/index.tsx`, `src/components/HomeScreen.tsx`, `src/components/clean/CleanTab.tsx`, `CleanScheduleScreen.tsx`, `BookingSummaryScreen.tsx`, `AddressSelectionScreen.tsx` (sheet wrapper).
- `SlotSelectionScreen` is also used by reschedule/other flows; it is deleted only if search shows no remaining users, otherwise listed as kept.
- No backend, booking or payment logic changes.
