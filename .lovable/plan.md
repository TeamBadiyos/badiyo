# Clean tab — bigger card photos and correct today/tomorrow

## 1. Service card photos
- Each photo is about 150% of the card's height. It sits on the card's bottom-right corner, flush with the bottom edge, with the head and shoulders rising well above the card's top.
- The whole photo is always shown, never cropped at the sides or top. The full width of the cut-out stays inside the right ~45% of the card.
- The card's text stays in the left ~55%, so it never runs under the photo.
- There is more space above the two cards, so the raised heads don't touch the banner's text.

## 2. {day} in banner text
{day} is worked out from the next opening time, using India time:
- If the next opening is today, it shows "today" / "आज".
- If the next opening is tomorrow, it shows "tomorrow" / "उद्या".
- For any later day, it shows the date (for example "18 Oct").
- If no next opening time is available: the Night banner says "tomorrow" if it is before midnight, and "today" after midnight. The Sunrise banner says "today".

## Technical details
- In `ServiceCard`:
  - The image is `absolute bottom-0 right-1 h-[150%] w-[45%] object-contain object-right-bottom` and is not clipped.
  - The text column is `w-[55%]`.
- The cards grid top padding grows from `pt-6` to about `pt-14`, which keeps the 50% overflow clear of the banner text.
- `CleanTab`: replace the string-parsing `dayWord` with a `dayLabel(next_open_at)` helper. It compares IST date keys (`toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`) for today, tomorrow and the date, with the fallback by banner state above.
- Checks: typecheck and a Playwright screenshot of the cards.
