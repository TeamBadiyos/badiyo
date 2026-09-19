create or replace function public.courier_orders_refund_hook()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.refund_status = 'refund_pending' and NEW.refund_amount > 0
     and (TG_OP = 'INSERT' or OLD.refund_status is distinct from 'refund_pending') then
    perform public.courier_dispatch_refund_job();
  end if;
  return NEW;
end $$;

revoke execute on function public.courier_orders_refund_hook() from public, anon, authenticated;

create trigger trg_courier_orders_refund_hook
  after update of refund_status on public.courier_orders
  for each row execute function public.courier_orders_refund_hook();

create or replace function public.courier_sweeper_tick()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.courier_sweeper();
  perform public.courier_dispatch_refund_job();
end $$;

revoke execute on function public.courier_sweeper_tick() from public, anon, authenticated;
grant execute on function public.courier_sweeper_tick() to service_role;