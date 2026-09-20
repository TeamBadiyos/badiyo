# Address system fix plan

Goal: search that actually works, a detected address nobody can tamper with, and a "current location" that behaves like a real saved address.

## 1. Working address search (both screens)

Google's Places API is blocked on the project key, so the current search can never return results. We switch search to the Geocoding API, which is already active on the same key.

- New server function `searchAddresses` (in `src/lib/geocode.functions.ts`): takes the typed text, biases results to Latur/Maharashtra, returns up to 5 matches with a title, full address, and coordinates.
- `AddAddressMapScreen`: the map search bar calls this instead of `searchPlaces`. Picking a result moves the pin and refreshes the detected address.
- `LocationPickerSheet` (home header): keeps showing matching saved addresses on top, and below that shows live "Search results" from the same function. Picking one opens the map screen with the pin already placed, so the address goes through the normal save flow.
- Debounced typing (~350 ms), stale responses ignored, clear "No results" and friendly error text — never a raw error code.
- `searchPlaces` / `getPlaceDetails` (blocked Places calls) are removed from the app paths.

## 2. Detected address becomes read-only

- Remove the edit button and textarea for the GPS-detected address in `AddAddressMapScreen`.
- Show it as a locked block with a small "Detected" tag, plus a hint that to change it the user should move the pin or search.
- The user still types freely in "Address details" (flat / house no / building / floor) and the label.
- If geocoding fails: show a clean "Could not detect address — Tap to retry" button instead of an editable box. Save stays disabled until an address is detected.

## 3. "Use current location" saves properly

- Instead of creating a temporary fake address, it opens the map screen with the pin at the user's GPS position and the detected address filled in.
- The user confirms details and saves, so booking always has a real saved address id.

## 4. Live serviceability on the map

- While the pin moves, check the zone in the background (same check the booking screens use).
- Show a green "Deliverable area" or red "Outside service area" tag right under the pin card.
- Outside the zone, Save is disabled with a short explanation, so nobody fills the whole form only to be blocked at the end.

## 5. Pincode captured

- Add a `pincode` column to the addresses table and store the postal code returned by Google alongside the address text. Existing addresses stay as they are.

## Technical notes

- Files touched: `src/lib/geocode.functions.ts` (new geocode-based search, drop Places calls), `src/components/AddAddressMapScreen.tsx` (search, read-only detected address, live zone tag, retry state, pincode), `src/components/LocationPickerSheet.tsx` (live search results, current-location routed through map save flow), `src/lib/serviceability.ts` (reuse existing checks), `src/i18n/en.ts` + `mr.ts` (new strings).
- One migration: `alter table public.addresses add column pincode text;` — no RLS or grant change needed.
- Zone check reuses `check_serviceability` / `courier_check_serviceability`; a failed check never hard-blocks (treated as serviceable) to match current behaviour.
- No change to pricing, payment, dispatch, or OTP logic.

## Not included

- Enabling Places API in Google Cloud (that is a console change on your side; the plan avoids needing it).
- Any redesign of booking, courier, or tracking screens.
