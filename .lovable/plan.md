# Store and Food tabs on the new home data

Rebuild the Store tab, and turn on the Food tab (currently "Coming soon"), as one shared layout. Both keep today's look, cart and shared Checkout, in English and Marathi. All data comes from the existing Command Center functions. The database is not changed.

## Home (Store and Food)
- Search bar that finds stores and items in that tab only.
- Food only: a small "🟢 100% Pure Veg" badge at the top. No veg marks on items.
- Category row with icons that scrolls sideways. Tapping a category shows the same home filtered to it.
- One small offer banner, shown only when Command Center has an active one.
- "Order again" row, signed-in users only. Tapping an item adds it to the cart; tapping a store opens it.
- "Recommended": up to 6 stores with no tag. Hidden when empty.
- All stores: open ones first, nearest first. Each card shows photo, name, store type, distance, a ⭐ rating (hidden when there is none) and the offer text if there is one.
- Closed stores sit at the bottom, greyed out. Tapping one shows "Opens <time>".
- No Open/Closed labels and no delivery times anywhere.

## Store page
- Photo header, name, type, distance and rating, then "⭐ Recommended" (up to 6), then the menu grouped by category.
- Store: 3-column grid with photo, name, size and price (the old price struck through when there is one), plus + Add / − qty +.
- Food: list layout like Zomato, with name, short description and price on the left and the photo on the right with + Add below it. Items with Half/Full options or add-on groups open a sheet first, which enforces each group's minimum and maximum picks.
- Out-of-stock items are greyed out, labelled "Out of stock" and moved to the end of their category.
- Closed store: the page is greyed out, shows "Opens …" and the add buttons are disabled.

## Cart and Checkout
- Bottom bar: "3 items · ₹540 → View cart". It opens the shared Checkout.
- Checkout items card with − qty +, a "+ Add more items" link back to the store, and the delivery fee from the backend quote.
- One cart at a time across all services. Adding from a different store or service asks before replacing the current cart.

## Profile → Notifications
- New "Offers & wallet reminders" switch, on by default. Turning it off saves the customer's opt-out to Command Center.

## Technical details
- `app_commerce_home(_service_key, _city_id, _lat, _lng, _category_id)` gives categories, banner, recommended and stores. City and lat/lng come from the selected address. A new query hook, keyed by service, city and category, keeps the per-city cache rules.
- `app_order_again(_service_key)` is called only with a session, because it returns empty for guests.
- `app_store_page(_store_id)` is the store page. It takes only the store ID, so distance is carried over from the home card.
- Item add-on rules come from `variants` / `addon_groups` (min/max) in the item data. Cart lines are keyed by item, variant and add-ons.
- The current `storeCart` is extended with item options and a service tag, and the one-cart rule is enforced there. Checkout reuses `BookingSummaryScreen` with the existing store delivery quote.
- The Notifications switch calls `app_set_offer_notifications(_on)`. Its starting value comes from the user's `offer_notifications` setting.
- Both tabs share one component, set to `store` or `food`; the old store list and category screens it replaces are removed. Guest-first rules stay: login is asked only at Checkout/Pay.
- English and Marathi strings go in `src/i18n/en.ts` / `mr.ts`.

## Verification
- Typecheck. A guest preview of both tabs: categories filter, store page, the Food add-on sheet and the cart bar.
- Signed-in Checkout, Order again and the Notifications switch can't be tested in the preview because I can't sign in with your accounts. They need a check on a phone.
