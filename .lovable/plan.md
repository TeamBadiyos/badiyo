# Clean tab — final layout

All text and images come from `app_service_content(_service_key, _city_id)` (`clean` = Maid, `wash` = Car & Bike Wash). Only the chosen app language is shown: English fields, or the `_mr` fields when Marathi is selected. If a Marathi field is empty, the English one is used, and if the server sends nothing, the current text and photos are used.

Live content checked today: both heroes have `heading: null` and `image_url: null`. All cards have empty included and not-included lists. Maid cards have no linked price, while wash cards are linked to Bike, Car and Combo. Option `name_mr` is empty.

## Layout (top to bottom)
1. **Maid hero card** with a `bg_color` background.
   - If there is a heading: heading (20px bold) with the subline below it (14px muted).
   - If there is no heading: the subline is the title (20px bold).
   - The button sits bottom-left and `image_url` sits on the right. With no image, the right side stays empty.
2. **Maid cards**: a photo and a title, 3 per row. Tapping one opens the details sheet.
3. **Wash hero card**: same layout. Below it are the wash cards, each showing its linked option's price (₹).
4. Closed notice line stays at the top when the service is closed.
5. **Refer & Earn** at the bottom.

Removed: the Schedule/Instant cards, the Instant sheet, the 6-tile "One Expert" section, the old wash grid, the offer card and Book again.

## Details sheet
Shows a big photo, the title, a ✓ Included list and a ✗ Not included list (each hidden when empty). The Book Now button opens the booking page. For wash, the card's own option is pre-selected.

## Booking page (full screen, Maid or Wash)
- Address line with Change (same behaviour as now: your choices are kept).
- Options as big image cards, 3 per row: name, original price struck through (when it is above the price), and price.
- 7 day cards in a horizontal scroll, with Today selected.
- Time is shown as three horizontally scrolling rows: Morning / Afternoon / Evening, using medium half-hour cards.
  - "Now" is the first card in today's Morning row, but only when `app_book_now_allowed` allows it. If Morning has no slots, it goes in the first row that does.
  - The earliest available time is pre-selected ("Now" if it is offered).
  - Full or closed times are grey and say "Full", and cannot be tapped.
  - An empty day shows the existing "day full" message with Notify me / See next day.
- **Continue · ₹price** opens the existing checkout. The bill and Pay amount still come from `app_booking_quote`, and payment logic is not changed.

## Technical details
- New `useServiceContent(key)` in `src/lib/serviceSettings.ts` (query keyed by city), with a small `pick(lang, en, mr)` helper.
- Options are mapped to existing `SegmentService` rows by `price_option_id` so checkout keeps working unchanged. Server name, price and image override what is displayed.
- The current `CleanScheduleScreen` is rewritten into the new booking page. It reuses the existing slot builder, `app_fully_booked_slots`, the hours checks and the 45-min notice rule.
- `CleanTab` is rewritten. `CleanBookSheet.tsx` is deleted, and `parts.tsx` gets `HeroCard`, `ContentCard`, `CardDetailsSheet` and `OptionImageCard`.
- Checks: typecheck, plus a guest Playwright run (hero cards → details → booking page → Continue reaches checkout) in both English and Marathi.
