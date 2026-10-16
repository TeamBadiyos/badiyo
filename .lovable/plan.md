# Clean tab — fixes

## 1. Header on the banner
- The wallet and profile buttons become solid white circles or pills, with a green icon and amount and a soft shadow. They stay readable on every banner colour.
- The address text stays white and gets a soft text shadow.
- This applies only on the Clean tab. Store and the other tabs are unchanged.

## 2. Service card titles
- The titles are read from Command Center content in English or Marathi.
- If Command Center has no title, the defaults are "Maid" / "मावशी" and "Car Wash" / "कार वॉश".
- Each title stays on one line, with "…" if it is too long. The title and › stay in the left part of the card and never run under the photo.

Note: the live content today has no field for these card titles, so Command Center needs to add one. The app will read `card_title` and `card_title_mr` inside `hero` for each service (`clean` / `wash`). Until those are filled, the defaults show.

## 3. Busy banner {next_slot}
When the banner is "All experts are busy", {next_slot} shows the next free half-hour time:
- Today: the first half-hour that is at least 45 minutes from now, within opening hours, and not marked full.
- If nothing is left today: tomorrow's first free time, shown as "tomorrow 10:00 AM".
- If nothing can be found, it falls back to the next opening time.

## 4. Card photos (like the reference)
- The whole photo is shown with the sides never cropped, sitting on the card's bottom-right corner so the figure stands on the card's bottom edge.
- The photo is about 125% of the card's height, so the head rises above the card's top edge.
- The photo uses the right ~45% of the card. Text uses only the left side, so nothing overlaps.

## Technical details
- In `HomeScreen.tsx` header, when `tab === "clean"`:
  - Wallet and profile buttons: `bg-card text-primary shadow-soft`.
  - Address: an inline `textShadow` using a foreground token at low opacity.
- `ServiceContent.hero` type gains `card_title?` and `card_title_mr?`. `CleanTab` uses `pick(lang, ...)` with defaults, and `s.wash` becomes "Car Wash" / "कार वॉश" for the card only. The section heading stays "Car & Bike Wash".
- `ServiceCard` layout:
  - Text column is `w-[55%] min-w-0` with `truncate`, and the chevron is inline after the truncated text.
  - Image: `absolute bottom-0 right-1 h-[125%] w-[45%] object-contain object-bottom`, with no rounded crop.
  - The card has no overflow clipping. The photo starts at the bottom, so it can only spill out at the top.
- {next_slot}:
  - Uses a small `useNextFreeSlot("clean")` query, built with `getAllHourSlots`, using today's and tomorrow's hours from the service state when they exist, otherwise the default window.
  - Calls `fetchAppFullySlots("clean", today, tomorrow)` and the 45-minute notice rule in IST.
  - Runs only when the busy banner is chosen.
- Checks: typecheck and a Playwright screenshot of the Clean tab.
