revoke all on function public.merchant_orders_ledger_on_complete() from public, anon, authenticated;
revoke all on function public.merchant_orders_ledger_reversal() from public, anon, authenticated;
revoke all on function public.merchants_default_commission() from public, anon, authenticated;
revoke all on function public.store_commission_snapshot(uuid, numeric) from public, anon, authenticated;