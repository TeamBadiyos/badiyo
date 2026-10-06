-- 1) Instant-booking gate: now + duration must finish before closing time.
create or replace function public.service_instant_allowed(_service_key text, _duration_minutes integer default 60)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  st jsonb; f record; hr record; start_at timestamptz := now(); end_at timestamptz;
  ldow int; start_t time; end_t time;
begin
  st := public.service_effective_state(_service_key, null, now());
  if not coalesce((st->>'can_order')::boolean, true) then
    return jsonb_build_object('ok', false, 'reason_code', coalesce(st->>'reason_code','closed'),
      'next_open_at', st->>'next_open_at', 'close_time', st->>'close_time');
  end if;
  select * into f from public.service_flags
   where service_key = _service_key and city = 'Latur' order by created_at limit 1;
  if not found or not coalesce(f.hours_enabled, false) then
    return jsonb_build_object('ok', true, 'reason_code', 'live');
  end if;
  end_at := start_at + make_interval(mins => greatest(coalesce(_duration_minutes, 60), 1));
  ldow := extract(dow from (start_at at time zone 'Asia/Kolkata'))::int;
  start_t := (start_at at time zone 'Asia/Kolkata')::time;
  end_t := (end_at at time zone 'Asia/Kolkata')::time;
  select * into hr from public.service_hours where service_flag_id = f.id and weekday = ldow;
  if not found then return jsonb_build_object('ok', true, 'reason_code', 'live'); end if;
  if hr.is_closed or start_t < hr.open_time or end_t > hr.close_time
     or (end_at at time zone 'Asia/Kolkata')::date <> (start_at at time zone 'Asia/Kolkata')::date then
    return jsonb_build_object('ok', false, 'reason_code', 'outside_hours',
      'open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  return jsonb_build_object('ok', true, 'reason_code', 'live');
end $function$;
revoke execute on function public.service_instant_allowed(text, integer) from public, anon;
grant execute on function public.service_instant_allowed(text, integer) to authenticated, service_role;

-- 2) Recover Rekha Jodhwani's paid order as today's 11 AM slot.
do $$
declare _bid uuid;
begin
  if exists (select 1 from public.payment_intents where id='4cf198c9-212d-4a6f-9a9b-02a10e46ee94' and booking_id is null) then
    perform set_config('app.booking_bypass','on', true);
    insert into public.bookings (user_id, address_id, booking_lat, booking_lng, price_option_id,
      service_category_id, service_label, service_duration_minutes, slot_type,
      scheduled_date, scheduled_time_slot, price, total_amount, razorpay_order_id, status)
    values ('57ce142d-ad72-4d37-bc17-dc0142ce6fc2','ee6cbd29-2d64-442f-af55-aed2b513429d',
      18.3956752, 76.5674264, 'e21a0c1a-4884-48b0-81dd-b9044f080132',
      '508641a3-59fd-457c-be6a-74879be354cc', '1 Hour', 60, 'scheduled',
      date '2026-10-06', '11 AM (11 AM – 12 PM)', 149, 156, 'order_TkExZ1sFd2h2Xb', 'confirmed')
    returning id into _bid;
    update public.payment_intents set status='fulfilled', booking_id=_bid, updated_at=now()
     where id='4cf198c9-212d-4a6f-9a9b-02a10e46ee94';
  end if;
end $$;