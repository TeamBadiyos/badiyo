# Clean tab: one "What our experts do" section

## What changes
- Remove the two separate sections, "What the maid does" and "Car & Bike Wash".
- Add one section in their place with the title "What our experts do" / "आमचे एक्सपर्ट काय करतात".
- It has 6 cards, 3 per row, in the current maid-card style:
  - Row 1: the 3 maid cards
  - Row 2: the 3 wash cards (Bike / Car / Combo)
  - Each card shows its photo and title only. There are no prices.
- Tapping a card opens its details sheet. The chips at the top of the sheet switch only between cards of the same service: the maid cards, or the wash cards. "Book now" works as it does today.
- The Refer & Earn card stays right after this section.

## Editable title
The app reads the section title from the Clean content in Command Center, in English and Marathi. If it isn't set there, the app shows the default title above.

Command Center doesn't have a field for this title yet. It needs to be added there in the separate Command Center project. Until then, the default title shows.

## Technical details
- `src/components/clean/CleanTab.tsx`: merge the two grids into one `grid-cols-3`. Build maid cards from `maidCards` and wash cards from `washCards`, rendering only the first 3 of each. Drop the `price` prop on the wash `ContentCardTile`s. `openDetail("clean", i)` and `openDetail("wash", i)` stay as they are, so the chips in each sheet stay within one service.
- Title: `pick(lang, maidContent?.section_title, maidContent?.section_title_mr)`, falling back to the bilingual default. Add the optional `section_title` / `section_title_mr` fields to the `ServiceContent` type.
- No database changes.
