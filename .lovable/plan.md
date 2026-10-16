# Wallet from the new wallet + live categories

## 1. One wallet everywhere
Use the new wallet total (cash + bonus) in every place that shows or uses wallet money:
- Home header wallet pill
- Checkout "Pay with wallet" switch, which then matches what the full-wallet payment uses
- Referral screen wallet figure
- Wallet page

Wallet page layout:
- Big total at the top
- "Cash ₹___"
- One line per bonus amount: "Bonus ₹___ · expires DD MMM", nearest expiry first, plus the short bonus note
- History from the new history list, with a "Load more" button. Each row shows its type: Top-up, Payment, Refund, Referral, Bonus, Bonus expired, Opening balance, Adjustment, Old coins. Money in shows in green with +, money out shows in grey with −.
- English and Marathi.

After a payment, a cancel, or a refund, all wallet figures refresh together.

## 2. Store/Food categories from the live list
- Store category tiles and shelves come from the new category list for the customer's city, so only categories with live shops or items appear.
- Names follow the app language (Marathi name when Marathi is on). Category images come from Command Center.
- "Other" categories always come last, in the order Command Center sets.
- Food uses the same list for food categories once Food has items. Food stays "Coming soon" until then.

## Technical details
- New `src/lib/wallet.ts`: `useWalletSummary()` calls `app_wallet_summary` and returns `{balance, cash, bonus, bonus_expiring[], bonus_note}`. `useWalletHistory()` is an infinite query over `app_wallet_history(_limit, _before)` using `next_before`. Both are enabled only when signed in.
- Replace `my_coin_balance` usage in HomeScreen and BookingSummaryScreen. Update ReferralDashboardScreen and rewrite WalletScreen. Cancel and payment paths invalidate `["wallet"]`.
- `src/lib/store.ts`: `fetchStoreCategories(cityId)` calls `app_categories('store_type', cityId)`. Each row is mapped to `StoreCategory` with `name` set to the name for the current language, `icon_url`/`image_path` for the picture, and `rank` taken from the returned order. The query key includes the city and language. Catalog/StoreListView keep their current grouping by `store_category_id`.
- Food: `useFoodCategories(cityId)` calls `app_categories('food', cityId)`. It is only used where Food lists categories.
- No database changes.
