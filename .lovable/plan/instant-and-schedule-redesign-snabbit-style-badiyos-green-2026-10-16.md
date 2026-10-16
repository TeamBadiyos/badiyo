# Instant and Schedule redesign (Snabbit-style, badiyos green)

Applies to Clean Home and Car & Bike Wash. All text in English and Marathi. Booking, payment and slot checks stay the same as today; only the screens change.

## 1. Instant sheet ("Instant ⚡")
- Top: address line with a Change button.
- "How long?" shows big cards, 3 per row. Each card has the duration on top, the ₹ price in bold, and the old price struck through when Command Center has one. The 2-hour card gets a "Popular" tag. For Wash, the cards show Bike / Car / Combo instead.
- One button at the bottom: "Continue · ₹___".
- The Book Now / Schedule switch is removed.
- If a duration can't be booked right now, its card is grey with a small "Full" tag. If none can be booked (or Clean is closed), a short message shows ("All experts are busy right now" or "We're closed now · Opens …") and the bottom button changes to "Schedule", which opens the Schedule page.

## 2. Schedule page (full screen, "Schedule")
- Back arrow, title, and the address line with Change.
- "Which day?": big day cards for 7 days (Today, Tomorrow, then weekday + date), scrolling sideways.
- "How long?": big duration cards scrolling sideways (same style as in Instant, with old price and "Popular" tag).
- "What time?" appears only after a duration is picked. Half-hour times show under Morning (before 12), Afternoon (12–4) and Evening (after 4), 4 per row. Past times are hidden; full times are grey with a "Full" tag. The times follow the service hours, in India time.
- Fixed bottom button: "Continue · ₹___", active only after a day, duration and time are picked.

## 3. Whole day full
- When a day has no open times: a green calendar picture with a "Full" tag (drawn in the app, no photo needed), the text "Today's slots are full 🙏 — we'll tell you when a slot opens", and two buttons: "🔔 Notify me" (asks for login if needed) and "See tomorrow →" (moves to the next day).

## 4. Change address bug
- Tapping Change closes the sheet or page first and then opens the address picker on top.
- After an address is picked (or the picker is closed), the same Instant sheet or Schedule page reopens with the chosen duration, day and time kept.

## Technical details
- New `src/components/clean/CleanScheduleScreen.tsx` (full page) and a rewritten `CleanBookSheet.tsx` (Instant only). Shared `DurationCard`, `DayCard` and `SlotsFullState` (an inline SVG drawn with design tokens) in `src/components/clean/parts.tsx`.
- "Popular": the option with `duration_minutes === 120`. Old price: `strikethrough_price` when it is greater than `price`.
- Per-duration "Full" in Instant: `service_instant_allowed` is called for each option's duration (cached). In Schedule, an option is full for the chosen day when none of its times are allowed.
- `CleanTab` keeps a `bookingDraft` state `{ kind: "instant" | "schedule", auto, optionId, day, slotMins }`. Change saves the draft, closes the sheet or page, and calls `onChangeAddress(onReturn)`. HomeScreen remembers that callback and runs it when the location picker closes, so the draft view reopens with its choices.
- The existing checks (`fetchSlotAllowed`, `list_fully_booked_slots`, `isHourBookable`, `slotFitsWindow`) and `onCheckout(option, slot)` are reused as they are.
