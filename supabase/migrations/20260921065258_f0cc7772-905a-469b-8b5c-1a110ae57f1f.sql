alter table public.bookings
  add column if not exists refund_attempts integer not null default 0,
  add column if not exists refund_next_attempt_at timestamptz,
  add column if not exists refund_error text;

insert into public.ops_settings (key, value, label)
values
  ('booking_cancel_fee_assigned', '100', 'Booking: cancellation fee (Rs) once an expert is assigned'),
  ('booking_cancel_fee_searching', '0', 'Booking: cancellation fee (Rs) while still searching for an expert')
on conflict (key) do nothing;

create or replace function public.booking_verify_job_secret(_secret text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare _stored text;
begin
  select decrypted_secret into _stored from vault.decrypted_secrets where name = 'courier_job_secret';
  if _stored is null or _secret is null then return false; end if;
  return _stored = _secret;
end $$;

revoke execute on function public.booking_verify_job_secret(text) from public, anon, authenticated;
grant execute on function public.booking_verify_job_secret(text) to service_role;

create or replace function public.booking_dispatch_refund_job()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare _secret text;
begin
  if not exists (
    select 1 from public.bookings
     where refund_status = 'pending'
       and refund_amount > 0
       and (refund_next_attempt_at is null or refund_next_attempt_at <= now())
  ) then
    return;
  end if;

  select decrypted_secret into _secret from vault.decrypted_secrets where name = 'courier_job_secret';
  if _secret is null then raise warning 'courier_job_secret missing'; return; end if;

  perform net.http_post(
    url := 'https://user.badiyos.com/api/public/bookings/process-refunds',
    headers := jsonb_build_object('Content-Type','application/json','x-job-secret', _secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning 'booking_dispatch_refund_job failed: %', sqlerrm;
end $$;

revoke execute on function public.booking_dispatch_refund_job() from public, anon, authenticated;
grant execute on function public.booking_dispatch_refund_job() to service_role;

create or replace function public.bookings_refund_wake()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
begin
  if new.refund_status = 'pending' and coalesce(new.refund_amount, 0) > 0 then
    perform public.booking_dispatch_refund_job();
  end if;
  return new;
end $$;

drop trigger if exists trg_zz_bookings_refund_wake on public.bookings;
create trigger trg_zz_bookings_refund_wake
after insert or update of refund_status on public.bookings
for each row execute function public.bookings_refund_wake();