# Rider pay: include the extra stops fee

Only `courier_settle_order` changes. Past orders are not paid again: the function still skips any order that already has `earnings_credited_at`, and nothing re-runs settlement.

## New formulas
Let `S = coalesce(stops_fee, 0)` and `keep = (100 - commission_pct) / 100`.

- **A. Delivered:** `round((base_amount + extra_fee + S) * keep, 2)`
- **B. Failed with clean return:** `round((base_amount + extra_fee + S) * keep, 2)`
- **C. Regular failed delivery:** `round((base_amount + S) * pct / 100 * keep, 2)`, where pct = `courier_failed_delivery_payout_pct` (default 50). extra_fee stays excluded, as today.
- **D. All pickups failed (cancelled):** `round((base_amount + extra_fee + S) * keep, 2)`
- **Paid return charges** (unchanged): add `round(sum(paid charges) * keep, 2)`.
- GST, platform fee and coupon discount stay excluded. Wallet entry, notification and status changes stay the same.

1+1 orders have stops_fee 0, so their pay does not change.

## Technical details
One migration with `CREATE OR REPLACE FUNCTION public.courier_settle_order(uuid)`: same body, with `+ coalesce(_o.stops_fee,0)` added in the four earning lines. Signature, security definer, search_path and grants stay the same.
