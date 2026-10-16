# Fix: Clean / Wash work cards crash ("This page didn't load")

## Cause (confirmed)
Command Center now saves each "included" / "not included" line on a work card as one item holding both languages: `{ en: "...", mr: "..." }`. The app still expects plain text lines, so opening the details sheet tries to show an object as text. The whole screen crashes and the error page appears. This affects every card under "What the maid does" and "Car & Bike Wash".

## Fix
- In `src/components/clean/CleanTab.tsx` (`toItem`), turn every included/not-included entry into plain text:
  - plain text: use it as is (keeps the old format working)
  - `{ en, mr }`: show the Marathi text in Marathi, otherwise the English text (fall back to the other one if empty)
  - anything else: skip it
- Keep supporting the older `included_mr` / `not_included_mr` lists.
- Allow both shapes in the `ContentCard` type in `src/lib/serviceSettings.ts`.

## Check
Open Daily Cleaning and a bike wash card in the preview. The sheet should open with the lists in English, and again in Marathi, with no error page.
