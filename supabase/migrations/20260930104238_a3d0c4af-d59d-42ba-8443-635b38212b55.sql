-- lovable-cron-fallback-reviewed: minute-level deadlines (slot-5/-15/-30, ASAP 3 min) require per-minute evaluation; user informed of 1440 runs/day
-- ============ 1. Settings ============
insert into public.ops_settings (key, value, label) values
  ('booking_dispatch_lead_minutes','60','Booking: start expert search this many minutes before the slot'),
  ('booking_buffer_minutes','5','Booking: buffer minutes'),
  ('slot_first_start_hour','10','Booking: first allowed slot start hour (IST)'),
  ('slot_last_start_hour','18','Booking: last allowed slot start hour (IST)'),
  ('asap_onway_deadline_minutes','3','Booking: ASAP — alert if expert not on the way within N minutes'),
  ('scheduled_onway_deadline_before_slot_minutes','15','Booking: scheduled — unassign if not on the way by slot minus N minutes'),
  ('expert_reminder_before_slot_minutes','30','Booking: remind assigned expert N minutes before slot'),
  ('no_expert_alert_before_slot_minutes','5','Booking: warn customer/admin if no expert by slot minus N minutes'),
  ('no_expert_refund_after_slot_minutes','30','Booking: auto-cancel + full refund if no expert by slot plus N minutes'),
  ('expert_journey_steps_enabled','0','Booking: enforce on_the_way/arrived journey steps (safety switch)')
on conflict (key) do nothing;

-- ============ 2. Booking columns ============
alter table public.bookings
  add column if not exists expert_assigned_at timestamptz,
  add column if not exists on_the_way_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists onway_alert_sent boolean not null default false,
  add column if not exists no_expert_alert_sent boolean not null default false,
  add column if not exists expert_slot_reminder_sent boolean not null default false;

-- ============ 3. Dispatch timing: hold scheduled bookings ============
create or replace function public.bookings_auto_dispatch()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare _lat numeric; _lng numeric; _zone uuid; _free boolean; _slot timestamptz; _lead int;
begin
  if NEW.status <> 'confirmed' then return null; end if;
  if NEW.assigned_expert_id is not null then return null; end if;
  if NEW.deleted_at is not null then return null; end if;

  _free := coalesce(NEW.total_amount, 0) = 0 and coalesce(NEW.razorpay_order_id, '') like 'free\_%';
  if (NEW.razorpay_payment_id is null or length(NEW.razorpay_payment_id) = 0) and not _free then
    return null;
  end if;
  if TG_OP = 'UPDATE' and OLD.razorpay_payment_id is not distinct from NEW.razorpay_payment_id
     and OLD.status is not distinct from NEW.status then
    return null;
  end if;

  _lat := NEW.booking_lat; _lng := NEW.booking_lng;
  if (_lat is null or _lng is null) and NEW.address_id is not null then
    select latitude, longitude into _lat, _lng from public.addresses where id = NEW.address_id;
  end if;
  if _lat is not null and _lng is not null then
    _zone := public.resolve_zone_for_point(_lat, _lng);
  end if;

  _lead := public.get_ops_num('booking_dispatch_lead_minutes', 60)::int;
  _slot := public.slot_start_ist(NEW.scheduled_date, NEW.scheduled_time_slot);

  perform set_config('app.booking_bypass', 'on', true);
  if _slot is not null and _slot > now() + make_interval(mins => _lead) then
    update public.bookings set zone_id = coalesce(_zone, zone_id) where id = NEW.id and status = 'confirmed';
  else
    update public.bookings
       set status = 'accepted', zone_id = coalesce(_zone, zone_id)
     where id = NEW.id and status = 'confirmed';
  end if;
  perform set_config('app.booking_bypass', 'off', true);

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (coalesce(NEW.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
          case when _free then 'auto_dispatch_free_order' else 'auto_dispatch_on_payment' end,
          'bookings', NEW.id, null,
          jsonb_build_object('actor_role','system','razorpay_payment_id', NEW.razorpay_payment_id,
                             'razorpay_order_id', NEW.razorpay_order_id, 'free', _free,
                             'held_for_lead_window', (_slot is not null and _slot > now() + make_interval(mins => _lead))));
  return null;
end $function$;

-- ============ 4. Per-minute release sweeper ============
create or replace function public.booking_dispatch_release_due()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare b record; _lead int; _n int := 0;
begin
  _lead := public.get_ops_num('booking_dispatch_lead_minutes', 60)::int;
  for b in
    select id from public.bookings
     where status = 'confirmed'
       and assigned_expert_id is null
       and deleted_at is null
       and (coalesce(razorpay_payment_id,'') <> '' or (coalesce(total_amount,0) = 0 and coalesce(razorpay_order_id,'') like 'free\_%'))
       and public.slot_start_ist(scheduled_date, scheduled_time_slot) is not null
       and public.slot_start_ist(scheduled_date, scheduled_time_slot) <= now() + make_interval(mins => _lead)
     limit 100
  loop
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set status = 'accepted' where id = b.id and status = 'confirmed';
    perform set_config('app.booking_bypass','off', true);
    _n := _n + 1;
  end loop;
  return _n;
end $function$;
revoke execute on function public.booking_dispatch_release_due() from public, anon, authenticated;
grant execute on function public.booking_dispatch_release_due() to service_role;

-- ============ 5. Stop the old 2h expiry from killing pre-dispatch bookings ============
create or replace function public.system_list_expired_unassigned_bookings()
returns table(id uuid, price numeric, razorpay_payment_id text, broadcast_started_at timestamptz, created_at timestamptz)
language sql security definer set search_path to 'public' as $function$
  select b.id, b.price, b.razorpay_payment_id, b.broadcast_started_at, b.created_at
  from public.bookings b
  cross join lateral (select coalesce((select no_expert_timeout_minutes from public.dispatch_config limit 1), 30) as mins) cfg
  where b.status in ('confirmed','accepted')
    and b.assigned_expert_id is null
    and b.deleted_at is null
    and public.slot_start_ist(b.scheduled_date, b.scheduled_time_slot) is null
    and coalesce(b.broadcast_started_at, b.created_at) < now() - make_interval(mins => cfg.mins)
  order by coalesce(b.broadcast_started_at, b.created_at)
  limit 50;
$function$;

create or replace function public.expand_stale_broadcasts()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare cfg record; b record; _new_radius numeric; _expanded integer := 0;
begin
  select * into cfg from public.dispatch_config limit 1;
  if cfg.id is null then return 0; end if;

  for b in
    select id, coalesce(current_search_radius_km, cfg.broadcast_radius_km) as radius
    from public.bookings
    where status = 'accepted' and assigned_expert_id is null and deleted_at is null
      and broadcast_started_at is not null
      and broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
      and coalesce(current_search_radius_km, cfg.broadcast_radius_km) < cfg.radius_expand_max_km
  loop
    _new_radius := least(b.radius + cfg.radius_expand_step_km, cfg.radius_expand_max_km);
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set current_search_radius_km = _new_radius where id = b.id;
    perform set_config('app.booking_bypass','off', true);
    perform public.broadcast_booking_to_experts(b.id, _new_radius);
    _expanded := _expanded + 1;
  end loop;

  perform set_config('app.booking_bypass','on', true);
  update public.bookings set dispatch_exhausted_at = now()
   where status = 'accepted' and assigned_expert_id is null and deleted_at is null
     and dispatch_exhausted_at is null and broadcast_started_at is not null
     and broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
     and coalesce(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km;
  perform set_config('app.booking_bypass','off', true);

  for b in
    select id from public.bookings
     where deleted_at is null and dispatch_alert_sent = false
       and dispatch_exhausted_at is not null and assigned_expert_id is null
       and status in ('accepted','confirmed','pending')
  loop
    perform public.notify_customer_alert(
      b.id, 'no_expert_found', 'Still looking for an expert',
      'No expert is available near you right now. We are still trying — you can also cancel for a full refund.',
      jsonb_build_object('route', 'booking/' || b.id::text));
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set dispatch_alert_sent = true where id = b.id;
    perform set_config('app.booking_bypass','off', true);
  end loop;
  return _expanded;
end $function$;

create or replace function public.rebroadcast_pending_advance_to_expert(_expert_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare b record; _n int := 0;
begin
  for b in
    select distinct bk.id
    from public.bookings bk
    join public.expert_zones ez on ez.zone_id = bk.zone_id and ez.expert_id = _expert_id
    where bk.status = 'accepted'
      and bk.assigned_expert_id is null
      and bk.deleted_at is null
      and bk.broadcast_started_at is not null
      and (bk.last_rebroadcast_at is null or bk.last_rebroadcast_at < now() - interval '30 minutes')
    limit 20
  loop
    perform public.broadcast_booking_to_experts(b.id, null);
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set last_rebroadcast_at = now() where id = b.id;
    perform set_config('app.booking_bypass','off', true);
    _n := _n + 1;
  end loop;
  return _n;
end $function$;

-- ============ 6. Stamp journey timestamps ============
create or replace function public.bookings_stamp_journey()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if NEW.status is distinct from OLD.status then
    if NEW.status = 'expert_assigned' then
      NEW.expert_assigned_at := now();
      NEW.on_the_way_at := null;
      NEW.arrived_at := null;
      NEW.onway_alert_sent := false;
    elsif NEW.status = 'accepted' then
      NEW.expert_assigned_at := null;
      NEW.on_the_way_at := null;
      NEW.arrived_at := null;
      NEW.onway_alert_sent := false;
    end if;
  end if;
  return NEW;
end $function$;
drop trigger if exists trg_bookings_stamp_journey on public.bookings;
create trigger trg_bookings_stamp_journey before update of status on public.bookings
  for each row execute function public.bookings_stamp_journey();

-- ============ 7. Expert journey RPCs ============
create or replace function public.expert_mark_on_the_way(p_booking_id uuid)
returns timestamptz language plpgsql security definer set search_path to 'public' as $function$
declare _expert_id uuid; _b record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;

  select id, assigned_expert_id, status, on_the_way_at into _b
    from public.bookings where id = p_booking_id for update;
  if _b.id is null then raise exception 'Booking not found'; end if;
  if _b.assigned_expert_id <> _expert_id then raise exception 'Not your booking'; end if;
  if _b.status in ('on_the_way','arrived','in_progress') then return coalesce(_b.on_the_way_at, now()); end if;
  if _b.status <> 'expert_assigned' then raise exception 'Booking not ready'; end if;

  perform set_config('app.booking_bypass','on', true);
  update public.bookings set status = 'on_the_way', on_the_way_at = now(), updated_at = now()
   where id = p_booking_id;
  perform set_config('app.booking_bypass','off', true);
  return now();
end $function$;
revoke execute on function public.expert_mark_on_the_way(uuid) from public, anon;
grant execute on function public.expert_mark_on_the_way(uuid) to authenticated, service_role;

create or replace function public.expert_mark_arrived(p_booking_id uuid)
returns timestamptz language plpgsql security definer set search_path to 'public' as $function$
declare _expert_id uuid; _b record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;

  select id, assigned_expert_id, status, arrived_at into _b
    from public.bookings where id = p_booking_id for update;
  if _b.id is null then raise exception 'Booking not found'; end if;
  if _b.assigned_expert_id <> _expert_id then raise exception 'Not your booking'; end if;
  if _b.status in ('arrived','in_progress') then return coalesce(_b.arrived_at, now()); end if;
  if _b.status not in ('expert_assigned','on_the_way') then raise exception 'Booking not ready'; end if;

  perform set_config('app.booking_bypass','on', true);
  update public.bookings
     set status = 'arrived', arrived_at = now(),
         on_the_way_at = coalesce(on_the_way_at, now()), updated_at = now()
   where id = p_booking_id;
  perform set_config('app.booking_bypass','off', true);
  return now();
end $function$;
revoke execute on function public.expert_mark_arrived(uuid) from public, anon;
grant execute on function public.expert_mark_arrived(uuid) to authenticated, service_role;

-- ============ 8. Start OTP gated by the safety switch ============
create or replace function public.expert_verify_start_otp(_booking_id uuid, _otp text)
returns timestamptz language plpgsql security definer set search_path to 'public' as $function$
declare _expert_id uuid; _b record; _end timestamptz; _duration int; _strict boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;
  if _otp is null or btrim(_otp) = '' then raise exception 'OTP required'; end if;

  select id, assigned_expert_id, status, start_otp, service_duration_minutes, service_end_at, end_otp
    into _b from public.bookings where id = _booking_id for update;
  if _b.id is null then raise exception 'Booking not found'; end if;
  if _b.assigned_expert_id <> _expert_id then raise exception 'Not your booking'; end if;
  if _b.status = 'in_progress' then return _b.service_end_at; end if;

  _strict := public.get_ops_flag('expert_journey_steps_enabled');
  if _strict then
    if _b.status <> 'arrived' then
      raise exception 'Mark yourself as arrived before starting the service';
    end if;
  else
    if _b.status not in ('expert_assigned','on_the_way','arrived') then
      raise exception 'Booking not ready to start';
    end if;
  end if;
  if _b.start_otp is null or btrim(_otp) <> _b.start_otp then raise exception 'Invalid start OTP'; end if;

  _duration := coalesce(_b.service_duration_minutes, 60);
  _end := now() + make_interval(mins => _duration);

  perform set_config('app.booking_bypass','on', true);
  update public.bookings
     set status = 'in_progress', started_at = now(), service_end_at = _end,
         end_otp = coalesce(end_otp, public.generate_otp4())
   where id = _booking_id;
  perform set_config('app.booking_bypass','off', true);
  return _end;
end $function$;

-- ============ 9. Customer notifications for new steps ============
create or replace function public.notify_customer_status_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare _title text; _body text; _alert text; _expert text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;

  if NEW.status = 'expert_assigned' then
    select name into _expert from public.experts where id = NEW.assigned_expert_id;
    _alert := 'expert_assigned'; _title := 'Expert assigned!';
    _body := coalesce(_expert, 'Your expert') || ' has accepted ' || coalesce(NEW.service_label, 'your booking') || '.';
  elsif NEW.status = 'on_the_way' then
    select name into _expert from public.experts where id = NEW.assigned_expert_id;
    _alert := 'expert_on_the_way'; _title := 'Expert on the way';
    _body := coalesce(_expert, 'Your expert') || ' has left and is on the way to you.';
  elsif NEW.status = 'arrived' then
    select name into _expert from public.experts where id = NEW.assigned_expert_id;
    _alert := 'expert_arrived'; _title := 'Expert has arrived';
    _body := coalesce(_expert, 'Your expert') || ' has reached your location. Please share the start OTP.';
  elsif NEW.status = 'in_progress' then
    _alert := 'service_started'; _title := 'Service started';
    _body := 'Your service has started. Estimated duration: ' || coalesce(NEW.service_duration_minutes, 60)::text || ' minutes.';
  elsif NEW.status = 'completed' then
    _alert := 'order_completed'; _title := 'Service completed';
    _body := 'Your booking is complete! Please rate your experience.';
  elsif NEW.status = 'cancelled' then
    _alert := 'booking_cancelled'; _title := 'Booking cancelled';
    _body := coalesce(NEW.cancellation_reason, 'Your booking has been cancelled.');
  elsif NEW.status = 'accepted' then
    _alert := 'booking_confirmed'; _title := 'Booking confirmed';
    _body := 'We are finding an expert for you.';
  else
    return NEW;
  end if;

  perform public.notify_customer_alert(NEW.id, _alert, _title, _body,
    jsonb_build_object('route', case when NEW.status = 'cancelled' then 'my-bookings'
                                     else 'booking/' || NEW.id::text end, 'status', NEW.status));
  return NEW;
end $function$;

-- ============ 10. Live location (privacy: only while moving) ============
create or replace function public.booking_get_expert_location(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare _b record; _e record; _stale int;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;
  select id, user_id, status, assigned_expert_id into _b from public.bookings where id = p_booking_id;
  if _b.id is null or _b.user_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;

  if _b.status not in ('on_the_way','arrived') or _b.assigned_expert_id is null then
    return jsonb_build_object('available', false, 'reason', 'not_moving');
  end if;

  select current_lat, current_lng, location_updated_at into _e
    from public.experts where id = _b.assigned_expert_id;
  if _e.current_lat is null or _e.current_lng is null then
    return jsonb_build_object('available', false, 'reason', 'no_fix');
  end if;

  _stale := public.courier_setting('courier_location_stale_seconds', 120)::int;
  return jsonb_build_object('available', true, 'lat', _e.current_lat, 'lng', _e.current_lng,
    'location_updated_at', _e.location_updated_at,
    'stale', coalesce(_e.location_updated_at < now() - make_interval(secs => _stale), true));
end $function$;
revoke execute on function public.booking_get_expert_location(uuid) from public, anon;
grant execute on function public.booking_get_expert_location(uuid) to authenticated, service_role;

-- ============ 11. Journey sweeper ============
create or replace function public.booking_journey_sweeper()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  b record; _n int := 0; _slot timestamptz;
  _asap int; _sched int; _rem int; _warn int; _refund int; _strict boolean;
  _cust text; _paid boolean;
begin
  _asap   := public.get_ops_num('asap_onway_deadline_minutes', 3)::int;
  _sched  := public.get_ops_num('scheduled_onway_deadline_before_slot_minutes', 15)::int;
  _rem    := public.get_ops_num('expert_reminder_before_slot_minutes', 30)::int;
  _warn   := public.get_ops_num('no_expert_alert_before_slot_minutes', 5)::int;
  _refund := public.get_ops_num('no_expert_refund_after_slot_minutes', 30)::int;
  _strict := public.get_ops_flag('expert_journey_steps_enabled');

  for b in
    select * from public.bookings
     where deleted_at is null
       and status in ('confirmed','accepted','expert_assigned','on_the_way')
     limit 500
  loop
    _slot := public.slot_start_ist(b.scheduled_date, b.scheduled_time_slot);
    select coalesce(full_name, 'Customer') into _cust from public.users where id = b.user_id;
    _paid := coalesce(b.razorpay_payment_id,'') <> '' and b.razorpay_payment_id not like 'free\_%'
             and coalesce(b.total_amount,0) > 0;

    if b.assigned_expert_id is null and b.status in ('confirmed','accepted') then
      if _slot is not null and now() >= _slot + make_interval(mins => _refund) then
        perform set_config('app.booking_bypass','on', true);
        update public.bookings
           set status = 'cancelled', cancellation_reason = 'no_expert_available',
               cancelled_by = 'system', cancelled_at = now(), cancellation_fee = 0,
               refund_amount = case when _paid then coalesce(total_amount,0) else 0 end,
               refund_status = case when _paid then 'pending' else 'not_applicable' end,
               refund_next_attempt_at = case when _paid then now() else null end
         where id = b.id;
        perform set_config('app.booking_bypass','off', true);
        perform public.notify_customer_alert(b.id, 'booking_cancelled', 'Booking cancelled',
          case when _paid then 'Koi expert nahi mil paaya, isliye booking cancel kar di gayi. Refund 5-7 din me aa jayega.'
               else 'Koi expert nahi mil paaya, isliye booking cancel kar di gayi.' end,
          jsonb_build_object('route','my-bookings'));
        perform public.admin_alert_enqueue('booking_no_expert_cancelled', b.id,
          coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0),
          coalesce(b.scheduled_time_slot,'Now'));
        _n := _n + 1;
      elsif _slot is not null and not b.no_expert_alert_sent
            and now() >= _slot - make_interval(mins => _warn) then
        perform set_config('app.booking_bypass','on', true);
        update public.bookings set no_expert_alert_sent = true where id = b.id;
        perform set_config('app.booking_bypass','off', true);
        perform public.notify_customer_alert(b.id, 'no_expert_found', 'Expert dhoondh rahe hain',
          'Expert dhoondh rahe hain, thoda late ho sakta hai.',
          jsonb_build_object('route','booking/' || b.id::text));
        perform public.admin_alert_enqueue('booking_no_expert_warning', b.id,
          coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0),
          coalesce(b.scheduled_time_slot,'Now'));
        _n := _n + 1;
      end if;
      continue;
    end if;

    if b.assigned_expert_id is not null and not b.expert_slot_reminder_sent
       and _slot is not null and now() >= _slot - make_interval(mins => _rem) and now() < _slot then
      perform set_config('app.booking_bypass','on', true);
      update public.bookings set expert_slot_reminder_sent = true where id = b.id;
      perform set_config('app.booking_bypass','off', true);
      perform public.notify_expert_push(b.assigned_expert_id, 'Booking ' || _rem::text || ' min me',
        coalesce(b.service_label,'Aapki booking') || ' ' || coalesce(b.scheduled_time_slot,'') ||
        ' — nikalne ki taiyaari karein.', 'booking/' || b.id::text);
      _n := _n + 1;
    end if;

    if _strict and b.status = 'expert_assigned' and b.assigned_expert_id is not null
       and b.expert_assigned_at is not null then
      if _slot is null then
        if not b.onway_alert_sent and now() >= b.expert_assigned_at + make_interval(mins => _asap) then
          perform set_config('app.booking_bypass','on', true);
          update public.bookings set onway_alert_sent = true where id = b.id;
          perform set_config('app.booking_bypass','off', true);
          perform public.admin_alert_enqueue('booking_onway_late', b.id,
            coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0), 'ASAP');
          _n := _n + 1;
        end if;
      elsif now() >= _slot - make_interval(mins => _sched)
            and now() >= b.expert_assigned_at + interval '2 minutes' then
        perform public.notify_expert_push(b.assigned_expert_id, 'Job hata diya gaya',
          'Ye job aapse hata diya gaya hai kyunki aap time par nikle nahi.', 'home');
        update public.experts set is_busy = false where id = b.assigned_expert_id;
        perform set_config('app.booking_bypass','on', true);
        update public.bookings
           set assigned_expert_id = null, status = 'accepted', last_rebroadcast_at = now()
         where id = b.id;
        perform set_config('app.booking_bypass','off', true);
        perform public.broadcast_booking_to_experts(b.id, null);
        perform public.admin_alert_enqueue('booking_expert_unassigned', b.id,
          coalesce(b.service_label,'Booking'), _cust, coalesce(b.total_amount,0),
          coalesce(b.scheduled_time_slot,'Now'));
        _n := _n + 1;
      end if;
    end if;
  end loop;
  return _n;
end $function$;
revoke execute on function public.booking_journey_sweeper() from public, anon, authenticated;
grant execute on function public.booking_journey_sweeper() to service_role;

-- ============ 12. Slot hours enforcement ============
create or replace function public.service_slot_allowed(_service_key text, _date date, _slot text, _duration_minutes integer default 60)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  st jsonb; f record; start_at timestamptz; end_at timestamptz;
  ldate date; ldow int; hr record; start_t time; end_t time; _first int; _last int; _h int;
begin
  st := public.service_effective_state(_service_key, null, now());
  if (st->>'status') <> 'live' then
    return jsonb_build_object('ok', false, 'reason_code', st->>'reason_code',
      'next_open_at', st->>'next_open_at', 'resume_at', st->>'resume_at');
  end if;

  start_at := public.slot_start_ist(_date, _slot);

  if start_at is not null then
    _first := public.get_ops_num('slot_first_start_hour', 10)::int;
    _last  := public.get_ops_num('slot_last_start_hour', 18)::int;
    _h := extract(hour from (start_at at time zone 'Asia/Kolkata'))::int;
    if _h < _first or _h > _last then
      return jsonb_build_object('ok', false, 'reason_code', 'outside_slot_window',
        'first_hour', _first, 'last_hour', _last);
    end if;
  end if;

  select * into f from public.service_flags
   where service_key = _service_key and city = 'Latur' order by created_at limit 1;
  if not found or not coalesce(f.hours_enabled, false) then
    return jsonb_build_object('ok', true, 'reason_code', 'live');
  end if;

  if start_at is null then start_at := now(); end if;
  end_at := start_at + make_interval(mins => greatest(coalesce(_duration_minutes, 60), 1));

  if start_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason_code', 'slot_passed');
  end if;

  ldate := (start_at at time zone 'Asia/Kolkata')::date;
  ldow := extract(dow from (start_at at time zone 'Asia/Kolkata'))::int;
  start_t := (start_at at time zone 'Asia/Kolkata')::time;
  end_t := (end_at at time zone 'Asia/Kolkata')::time;

  if exists (select 1 from public.service_holidays h
             where (h.service_flag_id = f.id or h.service_flag_id is null)
               and ldate between h.start_date and coalesce(h.end_date, h.start_date)) then
    return jsonb_build_object('ok', false, 'reason_code', 'holiday',
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if f.closed_today_date = ldate and (f.closed_until is null or f.closed_until > start_at) then
    return jsonb_build_object('ok', false, 'reason_code', 'closed_today',
      'next_open_at', coalesce(f.closed_until, public.service_next_open(f.id, start_at)));
  end if;

  select * into hr from public.service_hours where service_flag_id = f.id and weekday = ldow;
  if not found then return jsonb_build_object('ok', true, 'reason_code', 'live'); end if;
  if hr.is_closed then
    return jsonb_build_object('ok', false, 'reason_code', 'weekly_off',
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if start_t < hr.open_time or end_t > hr.close_time then
    return jsonb_build_object('ok', false, 'reason_code', 'outside_hours',
      'open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  return jsonb_build_object('ok', true, 'reason_code', 'live');
end $function$;

-- ============ 13. Cancellation: allow new statuses, free before assignment ============
create or replace function public.customer_cancel_booking_apply(_booking_id uuid, _cancellation_fee numeric, _refund_amount numeric, _refund_id text, _refund_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  _uid uuid := auth.uid(); _current text; _assigned uuid; _owner uuid;
  _before jsonb; _after jsonb; _expert_share numeric := 0; _fee numeric;
begin
  if _uid is null then raise exception 'Not authenticated'; end if;

  select to_jsonb(b), b.status, b.assigned_expert_id, b.user_id
    into _before, _current, _assigned, _owner
    from public.bookings b where b.id = _booking_id for update;
  if _before is null then raise exception 'Booking not found'; end if;
  if _owner is distinct from _uid then raise exception 'Forbidden'; end if;

  if _current not in ('confirmed','accepted','expert_assigned','on_the_way','arrived') then
    raise exception 'Cannot cancel — service has already started or booking is in terminal state (status: %)', _current;
  end if;

  _fee := case when _assigned is null then 0 else coalesce(_cancellation_fee, 0) end;
  if _assigned is null then
    _refund_amount := coalesce(_refund_amount, 0) + coalesce(_cancellation_fee, 0);
  end if;

  perform set_config('app.booking_bypass','on', true);
  update public.bookings
     set status = 'cancelled', cancellation_reason = 'customer_cancelled',
         cancellation_fee = _fee, refund_amount = _refund_amount,
         refund_id = _refund_id, refund_status = _refund_status,
         cancelled_by = 'customer', cancelled_at = now()
   where id = _booking_id;
  perform set_config('app.booking_bypass','off', true);

  if _assigned is not null then
    update public.experts set is_busy = false where id = _assigned;
    if _fee > 0 then
      _expert_share := round(_fee * public.courier_setting('cancel_fee_expert_share_pct', 50) / 100, 2);
      if _expert_share > 0 then
        insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
        values ('expert', _assigned, _expert_share, 'credit', 'booking_cancel_fee:' || _booking_id::text);
        update public.experts set wallet_balance = coalesce(wallet_balance,0) + _expert_share where id = _assigned;
      end if;
    end if;
  end if;

  select to_jsonb(b) into _after from public.bookings b where id = _booking_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (_uid, 'customer_cancel_booking', 'bookings', _booking_id, _before,
          _after || jsonb_build_object('actor_role','customer'));

  perform public.notify_customer_push(_booking_id, 'Booking cancelled',
    case when coalesce(_refund_amount,0) > 0
         then 'Booking cancel ho gayi. Refund 5-7 din me aa jayega.'
         else 'Booking cancel ho gayi. Koi refund applicable nahi hai.' end,
    'my-bookings');

  return jsonb_build_object('ok', true, 'cancellation_fee', _fee, 'refund_amount', _refund_amount);
end $function$;

-- ============ 14. Cron ============
select cron.schedule('booking-journey-sweeper', '* * * * *',
  $$select public.booking_dispatch_release_due(); select public.booking_journey_sweeper();$$);

comment on table public.ops_settings is 'No secrets here. Readable via get_ops_* helpers.';