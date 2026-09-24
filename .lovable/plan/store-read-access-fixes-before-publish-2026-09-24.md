# Store read-access fixes before publish

One database migration, three changes. No app-code changes needed. Verified `products.admin_hidden` already exists (set by MyAdmin), so point 1 can go in now.

## Changes

1. **public_products — hide admin-hidden products**
   Recreate the view with the same columns, adding `AND p.admin_hidden = false` to the existing filter (`is_active = true AND merchant_id IN (SELECT id FROM public_stores)`). Products MyAdmin has hidden will no longer appear in the customer app.

2. **public_stores — strict category filter**
   Recreate the view with the same columns (including `is_open_now`), changing the category condition from `m.store_category_id IS NULL OR sc.is_active = true` to `m.store_category_id IS NOT NULL AND sc.is_active = true`. Stores with no category will no longer show to customers.

3. **Revoke TRUNCATE**
   `REVOKE TRUNCATE ON public.merchants, public.products FROM anon, authenticated;`

## Technical details

- Use `CREATE OR REPLACE VIEW` with the exact current column lists (public_stores includes the computed `is_open_now` via `store_is_open_now(m.id)`), so no drop is needed and grants survive.
- No other policies touched; Merchant Hub unaffected.
- After applying: verify 1 store / 7 products still visible, TRUNCATE revoked, then report what changed.
- Publish not required for DB changes, but the Store UI still waits on tester phone numbers.
