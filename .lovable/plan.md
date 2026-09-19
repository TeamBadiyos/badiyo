# Parcel tab + courier pricing fix

## 1. "Courier pricing is not live yet"

Checked the database: Latur bike rates are now saved as live (base 25, 2 km included, 10/km, min 30, platform 5) and the courier switch for Latur is ON. So that exact message should no longer appear — the screenshot was taken before the rates were saved.

One real risk remains: the price check matches the city name exactly. The app sends the city taken from the saved address, so "latur", "Latur " or a blank/other city (e.g. only an area name saved) will not match the Latur rate row and the price call fails with a confusing message.

Fix:
- Match city ignoring case and extra spaces when looking up the courier switch and the rate row.
- If the address has no usable city, fall back to the city the courier service is switched on for.
- Make the on-screen messages plain: "Parcel delivery isn't available in your area yet" instead of pricing wording.

## 2. Bottom bar gets a Parcel tab

- Remove the "Send a parcel" card from the home page.
- Keep the "Courier" chip out of the row of service chips on home.
- Bottom bar becomes four tabs: Home, Orders, Send Parcel, Rewards. Orders stays the raised centre button; Send Parcel gets a package icon and sits between Orders and Rewards.
- Tapping Send Parcel opens the existing parcel booking screen.
- The Parcel tab only appears while parcel delivery is switched on for the city; otherwise the bar stays as today with three tabs.
- Labels added for both languages (English + Marathi).

## Technical notes

- `courier_quote_internal` / `courier_create_order`: `lower(trim(city))` comparison on `service_flags` and `courier_vehicle_rates` (migration; no pricing formula change).
- `CourierBookingScreen.tsx`: city fallback to the enabled courier city; friendlier error copy.
- `BottomNav.tsx`: add `parcel` tab key + `onParcel` prop, tab list built conditionally.
- `HomeScreen.tsx`: drop the parcel tile, filter `slug === "courier"` out of `ServicesBar` segments, pass `onParcel`.
- `OrdersScreen.tsx`, `RewardsScreen.tsx`, `routes/index.tsx`: pass `onParcel` → `setPhase("courier")`, plus `courierEnabled` flag for tab visibility.
- `i18n/en.ts`, `i18n/mr.ts`: `nav.parcel`.
