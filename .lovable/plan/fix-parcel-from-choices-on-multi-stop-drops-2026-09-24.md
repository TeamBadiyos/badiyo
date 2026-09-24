# Fix "Parcel from" choices on multi-stop drops

Only the booking screen's parcel-source logic changes. Everything else stays the same.

## What goes wrong today
- New extra stops get their name from the lowest free number (D2, D3...). Remove Drop 2 and add a new one, and the new drop reuses the name "D2", so it picks up the old drop's choice. That is why choices seem to jump between drops.
- Removing a drop does not clear its saved choice, and removing a pickup wipes every drop's choice.
- The chips don't tell the phone they are a pick-one group, so selections can look like they stack.

## Fix
1. **Separate choice per drop:** every extra stop gets its own ID that is never reused. Each drop's choice is saved under that ID, so changing one drop can never change another.
2. **One choice per drop:** the chips become a pick-one group (Pickup 1 / Pickup 2 / Both). Tapping one replaces the drop's previous choice. "Both" still means two parcels.
3. **Removing stops:**
   - Removing Pickup 2 clears only choices that used it ("Pickup 2" and "Both"). "Pickup 1" choices stay.
   - Removing a drop deletes only that drop's choice.
4. **Checks stay the same:** every drop needs a choice, and every pickup must be used by at least one drop, before Continue works.
5. **Summary before the price:** when there are 2 pickups, a short list shows one line per drop, e.g. "Drop 1: from Pickup 1 and Pickup 2". The list sits above the Continue button on the route step and on the price step. English and Marathi.
6. **Parcels sent with the order:** built only from these per-drop choices (Both = 2 parcels), using the same keys as the stops in the order.

## Technical details
- `CourierBookingScreen.tsx`: `nextKey` uses a counter kept in a ref (always goes up), so a key is never reused in the session. Stop numbering on screen (Drop 2, Drop 3) still comes from position.
- `onRemove`: for a drop, `delete dropSources[key]`. For a pickup, map `P2`/`both` to undefined and keep `P1`.
- `SourceChips` (MultiStopEditor): `role="radiogroup"`, each chip `role="radio"` with `aria-checked`. Value stays a single `DropSource`.
- New `courier.sourceSummary` keys in en/mr: "{drop}: from {list}".
- The `parcels` payload keeps using `sourcesOf(dk)` for `allDropKeys`, which now reads only current per-drop entries.
