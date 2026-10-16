# Clean tab: make Maid and Car Wash photos rise properly

## Why it isn't working now
The photo is fit into a box that is 45% of the card wide. The app scales the photo to fit that width, so even your new 500x750 cut-outs come out only about 76px wide and 114px tall. That's barely above the card. On the preview with no city picked, the app's own square photos showed, and they don't rise at all.

## What changes
- Photo sizing goes by height: exactly 150% of the card's height. It sits on the card's bottom-right corner, flush with the bottom edge, and is never cropped (the full cut-out shows).
- Card height goes to about 92px, so the photo is about 138px tall and about 92px wide. Your 2:3 cut-outs fill roughly the right 54% of the card, and the head and shoulders rise about 46px above the top.
- The text (icon, title ›, status) stays in the left ~46% and never runs under the photo. Long titles get "…" and the status line can wrap to 2 lines.
- More space above the cards so the raised heads clear the banner text.
- Closed service: photo stays greyscale, as now.

## Technical details
- `ServiceCard` in `src/components/clean/CleanTab.tsx`: card `min-h-[92px]`, `overflow-visible`. Image `absolute bottom-0 right-0 h-[150%] w-auto max-w-none object-contain object-bottom`, so it's height-driven with natural width. Text column `w-[46%]`, status `line-clamp-2`.
- Cards grid top padding: `pt-14` → `pt-16`.
- Check at 390px phone width with the Latur city photos. Measure that the photo is 150% of the card's height, its bottom edge matches the card's bottom, and it doesn't overlap the text box. Take a screenshot.
