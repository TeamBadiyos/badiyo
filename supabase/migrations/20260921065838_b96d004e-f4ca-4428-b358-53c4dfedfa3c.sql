create or replace function public.system_set_booking_refund_state(
  _booking_id uuid,
  _refund_status text,
  _refund_amount numeric default null,
  _refund_id text default null,
  _refund_attempts integer default null,
  _refund_next_attempt_at timestamptz default null,
  _refund_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.booking_bypass','on', true);
  update public.bookings
     set refund_status = coalesce(_refund_status, refund_status),
         refund_amount = coalesce(_refund_amount, refund_amount),
         refund_id = coalesce(_refund_id, refund_id),
         refund_attempts = coalesce(_refund_attempts, refund_attempts),
         refund_next_attempt_at = _refund_next_attempt_at,
         refund_error = _refund_error
   where id = _booking_id;
  perform set_config('app.booking_bypass','off', true);
end $$;

revoke execute on function public.system_set_booking_refund_state(uuid, text, numeric, text, integer, timestamptz, text) from public, anon, authenticated;
grant execute on function public.system_set_booking_refund_state(uuid, text, numeric, text, integer, timestamptz, text) to service_role;