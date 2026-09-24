# Store tab: grouped by category, one row per store

Only testers see this, same as now. The "Ordering starts soon" bar stays. There's no add-to-cart.

## What the customer sees

```text
Kirana & Grocery                      <- category title
+------------------------------------------------+
| [photo] Badiyos Demo Store  1.2 km  Open  New  |
| [prod] [prod] [prod]              View all ->  |
+------------------------------------------------+
| ...up to 3 nearest stores                      |
See all Kirana & Grocery stores ->    (only if >3)

Pharmacy
...
```

- Categories: only active ones that have at least one store inside the 5 km radius. They follow the order set in Command Center. The category's column is `rank`, which does the same job as `sort_order`.
- Each store row:
  - Top line: small photo, name, distance, Open/Closed, and a "New" badge when there's no rating.
  - Below that: 3 product cards (photo, name, unit, price), in-stock items first. Then "View all" at the end, which opens the store page that's already built.
- Stores with no in-stock items are hidden.
- Closed stores go last in their category, greyed out.
- "See all [Category] stores" opens a full-screen list of that category's stores in the same row style. It has a back button.
- The category chips at the top are removed. Grouping by category replaces them.
- Empty state stays: "No stores in your area yet".
- Design: green #00B97A, Nunito Sans, rounded corners of 18.

## Technical details

- `src/lib/store.ts`: add `fetchStorePreviewProducts(merchantIds)`. It runs one query on `public_products` with `.in("merchant_id", ids)` and sorts by `in_stock desc`, then name. It returns a map of up to 3 items per store plus an in-stock count. Hook: `useStorePreviewProducts(ids)`.
- New `src/components/store/StoreRow.tsx`: row header plus a horizontal strip of product cards and a "View all" tile. It uses `StoreImage` (signed URLs), `StoreRating` ("New" badge) and `isStoreOpen` (`is_open_now`).
- New `src/components/store/StoreCategoryScreen.tsx`: full list for one category using `StoreRow`, plus a header with a back button and the "Ordering starts soon" bar.
- `StoreListView.tsx` is rewritten:
  - Filter to stores in range, then drop stores with 0 in-stock items.
  - Group by `store_category_id` in category `rank` order.
  - Within each category: open stores by distance, then closed stores by distance. Show the first 3, plus a "See all" button when there are more.
- `HomeScreen.tsx`: add `openCategory` state, which shows StoreCategoryScreen (same pattern as `openStore`). A store row opened from the category screen still goes to the store page, and back returns to the category screen.
- i18n en/mr: `store.viewAll`, `store.seeAllIn` ("See all {name} stores"), `store.backToStores`.
- The Store tab gets a "Ordering starts soon" bar here too, same as on the store page.
- No database changes.
- Checks: typecheck, plus a 412x915 screen test with a tester session.
