# Store read-access — small fixes

Three small database fixes to the Store feature's read access. No other policies change.

## 1. public_stores — stricter category filter

Recreate the `public_stores` view with the filter changed from:

```text
(m.store_category_id IS NULL OR sc.is_active = true)
```

to:

```text
m.store_category_id IS NOT NULL AND sc.is_active = true
```

Effect: stores with no category no longer appear in the customer list; only stores with an active category show. Columns, grants (authenticated only), and everything else stay identical.

## 2. public_products — hide admin-hidden products

Verified live: the `products.admin_hidden` column does **not** exist yet (it is expected from the Command Center change). The migration will therefore use a conditional block:

- If `products.admin_hidden` exists when the migration runs, recreate `public_products` with `AND p.admin_hidden = false` added to the filter.
- If it does not exist yet, leave `public_products` as-is (a follow-up migration will add the filter once the column lands).

This keeps the migration safe to run in either order.

## 3. Revoke TRUNCATE on merchants and products

```sql
REVOKE TRUNCATE ON public.merchants FROM anon, authenticated;
REVOKE TRUNCATE ON public.products FROM anon, authenticated;
```

Defence in depth — clients should never be able to empty these tables. No other privileges or policies are touched.

## Verification after migration

- Re-read both view definitions to confirm the new filters.
- Confirm authenticated SELECT on `public_stores` / `public_products` still works.
- Merchant Hub policies untouched — `/products` and POS keep working as before.

## Technical details

- Single migration via the Supabase migration tool: `CREATE OR REPLACE VIEW public.public_stores ...`, conditional `DO $$ ... $$` block for `public_products`, and the two `REVOKE` statements.
- No UI changes, no Merchant Hub changes, no other policy changes.
