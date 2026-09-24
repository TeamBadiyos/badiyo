# Store tab: neater product cards

## What changes (Store tab, still testers only)

**Store header**
- Photo, name, distance, Open/Closed and "New" stay on the left.
- A small green **"View all →"** link sits in the top-right corner of the header and opens the store page.
- The big green "View" tile at the end of the product row is removed.

**Product cards (all the same size, lined up)**
- Every card is the same fixed width and height, so all cards line up side by side. The price and the button always sit at the same level on every card.
- Line 1: **name on one line only**. If it's too long it ends with "…". Tapping the card opens the store page.
- Line 2: **size**, for example "500 ml", "5 kg" or "1 kg". It's taken from the brackets in the product name, so the name line stays short. If a product has no size, the line stays empty so the cards still line up.
- Line 3: **pack type**: piece, pack, kg, litre.
- Below that: **price**, with the MRP crossed out when it's higher. On the right, a round green **"+ Add"** button.
- Out-of-stock items look faded, and "Out of stock" replaces the Add button.

**All items, not just 3**
- The row shows every product in the store, not just 3. Swipe sideways to see the rest.
- You'll see about 2.5 cards at a time, so it's obvious the row scrolls.

**Add to cart for now**
- There's no cart or checkout yet. Tapping "+ Add" gives a light vibration and shows the branded popup "Ordering starts soon". The bottom "Ordering starts soon" bar stays.
- Once cart and checkout are built, the same button will add the item to the cart.

**Look**
- Soft light-green panel behind each photo and 18px rounded corners, in Badiyos Green and the current app font.
- The Add button gets a slight shadow and a small press effect.
- The store page shows its products in the same card style, 2 per row.

## Technical details
- `src/lib/store.ts` `fetchStorePreviewProducts`: remove the 3-item cap and keep the in-stock-first order.
- New `src/components/store/ProductCard.tsx`: fixed `w-[132px]`, a square image, `truncate` name, size parsed with the regex `/\(([^)]+)\)\s*$/` (the display name has that part removed), unit, and a price row with `mt-auto`. Add button calls `haptic` + `toast(t("store.orderingSoon"))`.
- `StoreRow.tsx`: add a header-right "View all" button and use `ProductCard` in a horizontal scroll (`snap-x`). Remove the trailing tile.
- `StoreDetailScreen.tsx`: reuse `ProductCard` in a 2-column grid.
- i18n: add `store.add` to en ("Add") and mr ("जोडा").
