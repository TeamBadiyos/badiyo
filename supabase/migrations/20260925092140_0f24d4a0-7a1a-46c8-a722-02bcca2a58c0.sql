revoke all on function public.business_orders_qty_check() from public, anon, authenticated;

drop policy if exists "dispatch state ops read" on public.business_dispatch_state;
create policy "dispatch state ops read" on public.business_dispatch_state
for select to authenticated using (public.courier_is_ops_staff());

drop policy if exists "batch wake state ops read" on public.business_batch_wake_state;
create policy "batch wake state ops read" on public.business_batch_wake_state
for select to authenticated using (public.courier_is_ops_staff());

grant select on public.business_dispatch_state to authenticated;
grant select on public.business_batch_wake_state to authenticated;