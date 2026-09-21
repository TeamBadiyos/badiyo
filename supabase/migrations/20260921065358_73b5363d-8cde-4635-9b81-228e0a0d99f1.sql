create or replace function public.bookings_refund_wake()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
begin
  if new.refund_status = 'pending'
     and coalesce(new.refund_amount, 0) > 0
     and (new.refund_next_attempt_at is null or new.refund_next_attempt_at <= now())
  then
    perform public.booking_dispatch_refund_job();
  end if;
  return new;
end $$;

select cron.alter_job(
  8,
  command := 'select public.courier_sweeper_tick(); select public.booking_dispatch_refund_job();'
);