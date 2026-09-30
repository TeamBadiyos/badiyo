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
      -- ring alert (same treatment as reminder_10min) so the phone wakes up
      perform public.notify_expert_alert(
        b.assigned_expert_id, 'reminder_30min',
        'Booking ' || _rem::text || ' min me',
        coalesce(b.service_label,'Aapki booking') || ' ' || coalesce(b.scheduled_time_slot,'') ||
        ' — nikalne ki taiyaari karein.',
        jsonb_build_object('booking_id', b.id, 'type', 'reminder_30min',
                           'priority', 'high', 'route', 'booking/' || b.id::text)
      );
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

create or replace function public.expert_mark_arrived(p_booking_id uuid)
returns timestamptz language plpgsql security definer set search_path to 'public' as $function$
declare _expert_id uuid; _b record; _strict boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;

  _strict := public.get_ops_flag('expert_journey_steps_enabled');

  select id, assigned_expert_id, status, arrived_at into _b
    from public.bookings where id = p_booking_id for update;
  if _b.id is null then raise exception 'Booking not found'; end if;
  if _b.assigned_expert_id <> _expert_id then raise exception 'Not your booking'; end if;
  if _b.status in ('arrived','in_progress') then return coalesce(_b.arrived_at, now()); end if;

  if _strict then
    if _b.status <> 'on_the_way' then
      raise exception 'Pehle On the way mark karein';
    end if;
  else
    if _b.status not in ('expert_assigned','on_the_way') then raise exception 'Booking not ready'; end if;
  end if;

  perform set_config('app.booking_bypass','on', true);
  update public.bookings
     set status = 'arrived', arrived_at = now(),
         on_the_way_at = coalesce(on_the_way_at, now()), updated_at = now()
   where id = p_booking_id;
  perform set_config('app.booking_bypass','off', true);
  return now();
end $function$;