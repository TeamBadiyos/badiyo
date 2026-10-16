# Clean tab — banner states and new details sheet

All content comes from `app_service_content`. The app no longer reads anything from `app_clean_media` (no screen calls it today, so nothing else changes).

## 1. Top banner (Maid / 'clean')
The app picks one banner using the opening hours, the Book Now check and India time:

```text
holiday today                    -> holiday
open + campaign.active           -> campaign
open + Book Now allowed          -> open_available
open + Book Now full/busy        -> open_busy
closed, after closing to 23:59   -> closed_evening
closed, 00:00 until opening      -> closed_morning
```

- The banner's own image, title and sub-line are used. If there's no image, the current sky colour stays.
- Words in curly brackets are filled in:
  - {greeting}: Good morning (00–12), Good afternoon (12–17), Good evening (17–24). The Marathi greeting is used in Marathi.
  - {name}: the customer's first name. For guests it is dropped together with its comma.
  - {open_time}: today's or the next opening time.
  - {day}: today / tomorrow / the date.
  - {next_slot}: the next free time.

## 2. Details sheet (tap any Maid or Wash card)
- Title: "What is included?" (Marathi: "यात काय समाविष्ट आहे?").
- A row of chips for that section's 3 cards, each with a small photo and title. The selected chip is green, and tapping another chip switches the content inside the same sheet.
- The big photo of the selected card.
- Two lists, each hidden when it is empty:
  - Included: titled with `details.included_title`, with green ticks.
  - Not included: titled with `details.excluded_title`, with orange crosses.
- A note box with its icon (supplies / water) and `details.note`. It is hidden when the note is blank.
- One Book Now button. For Wash it pre-selects the chosen card's option.

## Technical details
- `serviceSettings.ts`: add `banners`, `campaign` and `details` to the `ServiceContent` type, and remove the local casts in `CleanTab`.
- `CleanTab` state picker:
  - Add `useBookNowAllowed("clean")`.
  - Holiday: `reason_code` matches holiday.
  - Closed evening vs morning: compare the current India time to `open_time` (before opening = morning, otherwise evening).
  - `{next_slot}`: the first open half-hour slot from the existing slot builder, falling back to the next opening time.
- First name: read the signed-in user's `users.full_name` (first word) with a small cached query. It is skipped for guests.
- Add an orange token (`--warning`) in `styles.css` for the crosses.
- The details sheet becomes a component in `parts.tsx` that takes the section's cards, the selected index and the details block.
- Checks: typecheck, and a Playwright run of the guest banner and the details-sheet chip switching for both Maid and Wash.
