-- ============================================================================
-- ROLLBACK: Service Status + Service Hours system
-- Runs in Supabase SQL Editor. Reverts everything the feature added.
-- ============================================================================

-- 1. Drop the hourly resume cron job
select cron.unschedule('service-resume-sync');

-- 2. Restore bookings_before_insert (original, without the hours guard)
create or replace function public.bookings_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _price numeric;
  _addr_lat numeric;
  _addr_lng numeric;
  _bypass text;
  _cat uuid;
  _gst numeric;
begin
  begin _bypass := current_setting('app.booking_bypass', true); exception when others then _bypass := null; end;

  select price into _price from public.service_catalogue_config
   where duration_minutes = NEW.service_duration_minutes and is_active = true
   order by created_at desc limit 1;

  if _price is null then
    select spo.customer_price into _price
      from public.service_price_options spo
      join public.services sv on sv.id = spo.service_id
     where spo.is_active = true and sv.is_active = true
       and lower(spo.label) = lower(coalesce(NEW.service_label, ''))
     order by spo.display_order
     limit 1;
  end if;

  if _price is null and NEW.service_duration_minutes is not null then
    select spo.customer_price into _price
      from public.service_price_options spo
      join public.services sv on sv.id = spo.service_id
     where spo.is_active = true and sv.is_active = true
       and spo.duration_minutes = NEW.service_duration_minutes
     order by spo.display_order
     limit 1;
  end if;

  if _price is null then
    raise exception 'Invalid service duration';
  end if;
  NEW.price := _price;

  _gst := coalesce(public.get_gst_percent(), 0);
  if _gst < 0 or _gst > 100 then _gst := 0; end if;
  NEW.gst_percent := _gst;
  NEW.gst_amount := round(_price * _gst / 100.0, 2);
  NEW.total_amount := _price + NEW.gst_amount;

  NEW.status := 'confirmed';
  NEW.rating := null;
  NEW.review_text := null;

  if _bypass is distinct from 'on' then
    NEW.assigned_expert_id := null;
    NEW.refund_id := null;
    NEW.refund_status := null;
    NEW.refund_amount := null;
    NEW.cancellation_fee := null;
    NEW.cancellation_reason := null;
    NEW.cancelled_by := null;
    NEW.cancelled_at := null;
    NEW.started_at := null;
    NEW.service_end_at := null;
    NEW.start_otp := null;
    NEW.end_otp := null;
    NEW.broadcast_started_at := null;
    NEW.current_search_radius_km := null;
    NEW.deleted_at := null;
    NEW.deleted_by := null;
    NEW.delete_reason := null;
  end if;

  if NEW.service_category_id is null then
    select sv.category_id into _cat
      from public.service_price_options spo
      join public.services sv on sv.id = spo.service_id
      join public.service_categories sc on sc.id = sv.category_id
     where spo.is_active = true and sv.is_active = true and sc.is_active = true
       and lower(spo.label) = lower(coalesce(NEW.service_label, ''))
     order by spo.display_order
     limit 1;

    if _cat is null and NEW.service_duration_minutes is not null then
      select sv.category_id into _cat
        from public.service_price_options spo
        join public.services sv on sv.id = spo.service_id
        join public.service_categories sc on sc.id = sv.category_id
       where spo.is_active = true and sv.is_active = true and sc.is_active = true
         and spo.duration_minutes = NEW.service_duration_minutes
       order by spo.display_order
       limit 1;
    end if;

    if _cat is null then
      select scc.service_category_id into _cat
        from public.service_catalogue_config scc
       where scc.is_active = true
         and scc.duration_minutes = NEW.service_duration_minutes
         and scc.service_category_id is not null
       order by scc.created_at desc
       limit 1;
    end if;

    NEW.service_category_id := _cat;
  end if;

  if (NEW.booking_lat is null or NEW.booking_lng is null) and NEW.address_id is not null then
    select latitude, longitude into _addr_lat, _addr_lng
      from public.addresses where id = NEW.address_id;
    if NEW.booking_lat is null then NEW.booking_lat := _addr_lat; end if;
    if NEW.booking_lng is null then NEW.booking_lng := _addr_lng; end if;
  end if;

  if NEW.booking_lat is null or NEW.booking_lng is null then
    raise exception 'Booking requires geographic coordinates: booking_lat/booking_lng were not provided and could not be resolved from address_id %', NEW.address_id
      using errcode = 'check_violation', hint = 'Ensure the selected address has latitude/longitude, or pass booking_lat/booking_lng explicitly.';
  end if;

  return NEW;
end $$;

-- 3. Restore courier_create_order (original, without the hours guard)
create or replace function public.courier_create_order(_customer_id uuid, _payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _q jsonb; _id uuid; _route jsonb;
begin
  if _customer_id is null then raise exception 'Not authenticated' using errcode='42501'; end if;

  if coalesce((_payload->>'prohibited_items_confirmed')::boolean, false) is not true then
    raise exception 'Please confirm that the parcel has no prohibited items';
  end if;

  _route := public.courier_validate_local_route(
    _payload->>'city',
    (_payload->>'pickup_lat')::numeric,
    (_payload->>'pickup_lng')::numeric,
    (_payload->>'drop_lat')::numeric,
    (_payload->>'drop_lng')::numeric
  );
  if not coalesce((_route->>'ok')::boolean, false) then
    raise exception '%', _route->>'message';
  end if;

  _q := public.courier_quote_internal(
    _customer_id,
    _payload->>'city',
    (_payload->>'vehicle_type_id')::uuid,
    (_payload->>'courier_type_id')::uuid,
    (_payload->>'distance_km')::numeric,
    coalesce((_payload->>'weight_kg')::numeric, 0),
    _payload->>'coupon_code'
  );

  insert into public.courier_orders (
    customer_id, city, vehicle_type_id, courier_type_id,
    pickup_lat, pickup_lng, pickup_address, pickup_contact_name, pickup_contact_phone,
    drop_lat, drop_lng, drop_address, drop_contact_name, drop_contact_phone,
    package_description, weight_kg, prohibited_items_confirmed,
    distance_km, distance_source, fare_breakdown, quote_expires_at,
    base_amount, extra_fee, platform_fee, discount_amount, coupon_id, coupon_code,
    gst_percent, gst_amount, total_amount, commission_pct, status
  ) values (
    _customer_id, _payload->>'city', (_payload->>'vehicle_type_id')::uuid, (_payload->>'courier_type_id')::uuid,
    (_payload->>'pickup_lat')::numeric, (_payload->>'pickup_lng')::numeric, _payload->>'pickup_address',
    _payload->>'pickup_contact_name', _payload->>'pickup_contact_phone',
    (_payload->>'drop_lat')::numeric, (_payload->>'drop_lng')::numeric, _payload->>'drop_address',
    _payload->>'drop_contact_name', _payload->>'drop_contact_phone',
    _payload->>'package_description', coalesce((_payload->>'weight_kg')::numeric,0), true,
    (_q->>'distance_km')::numeric, coalesce(_payload->>'distance_source','routes'), _q,
    (_q->>'quote_expires_at')::timestamptz,
    (_q->>'base_amount')::numeric, (_q->>'extra_fee')::numeric, (_q->>'platform_fee')::numeric,
    (_q->>'discount_amount')::numeric, nullif(_q->>'coupon_id','')::uuid, _q->>'coupon_code',
    (_q->>'gst_percent')::numeric, (_q->>'gst_amount')::numeric, (_q->>'total_amount')::numeric,
    (_q->>'commission_pct')::numeric, 'REQUESTED'
  ) returning id into _id;

  return jsonb_build_object('ok', true, 'order_id', _id, 'quote', _q);
end $$;

-- 4. Restore system_list_expired_unassigned_bookings (original)
create or replace function public.system_list_expired_unassigned_bookings()
returns TABLE(id uuid, price numeric, razorpay_payment_id text, broadcast_started_at timestamptz, created_at timestamptz)
language sql security definer set search_path = public as $$
  SELECT b.id, b.price, b.razorpay_payment_id, b.broadcast_started_at, b.created_at
  FROM public.bookings b
  CROSS JOIN LATERAL (SELECT COALESCE((SELECT no_expert_timeout_minutes FROM public.dispatch_config LIMIT 1), 30) AS mins) cfg
  WHERE b.status IN ('confirmed','accepted')
    AND b.assigned_expert_id IS NULL
    AND b.deleted_at IS NULL
    AND COALESCE(b.broadcast_started_at, b.created_at) < now() - make_interval(mins => cfg.mins)
  ORDER BY COALESCE(b.broadcast_started_at, b.created_at)
  LIMIT 50;
$$;

-- 5. Restore expand_stale_broadcasts (original, without the slot guard)
create or replace function public.expand_stale_broadcasts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  cfg record;
  b record;
  _new_radius numeric;
  _expanded integer := 0;
begin
  select * into cfg from public.dispatch_config limit 1;
  if cfg.id is null then return 0; end if;

  for b in
    select id, coalesce(current_search_radius_km, cfg.broadcast_radius_km) as radius
    from public.bookings
    where status = 'accepted'
      and assigned_expert_id is null
      and deleted_at is null
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
  update public.bookings
     set dispatch_exhausted_at = now()
   where status = 'accepted'
     and assigned_expert_id is null
     and deleted_at is null
     and dispatch_exhausted_at is null
     and broadcast_started_at is not null
     and broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
     and coalesce(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km;
  perform set_config('app.booking_bypass','off', true);

  for b in
    select id from public.bookings
     where deleted_at is null
       and dispatch_alert_sent = false
       and dispatch_exhausted_at is not null
       and assigned_expert_id is null
       and status in ('accepted','confirmed','pending')
  loop
    perform public.notify_customer_alert(
      b.id, 'no_expert_found', 'Still looking for an expert',
      'No expert is available near you right now. We are still trying — you can also cancel for a full refund.',
      jsonb_build_object('route', 'booking/' || b.id::text)
    );
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set dispatch_alert_sent = true where id = b.id;
    perform set_config('app.booking_bypass','off', true);
  end loop;

  return _expanded;
end;
$$;

-- 6. Restore expert_set_online (original)
create or replace function public.expert_set_online(_online boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _expert_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;
  update public.experts set is_online = coalesce(_online, false) where id = _expert_id;
end $$;

-- 7. Drop all new functions
drop function if exists public.slot_start_ist(date, text);
drop function if exists public.service_hours_bypass();
drop function if exists public.service_next_open(uuid, timestamptz);
drop function if exists public.service_effective_state(text, text, timestamptz);
drop function if exists public.service_can_order(text, timestamptz);
drop function if exists public.service_window(text, text);
drop function if exists public.service_slot_allowed(text, date, text, int);
drop function if exists public.staff_require_super_admin();
drop function if exists public.staff_set_service_status(text, text, text, text, timestamptz);
drop function if exists public.notify_service_waiters(text);
drop function if exists public.customer_notify_me(text);
drop function if exists public.staff_set_service_hours(text, int, time, time, boolean);
drop function if exists public.staff_set_last_order_buffer(text, int);
drop function if exists public.staff_set_service_holiday(text, date, date, text, text);
drop function if exists public.staff_remove_service_holiday(uuid);
drop function if exists public.staff_close_service_today(text, text, timestamptz);
drop function if exists public.staff_reopen_service_today(text);
drop function if exists public.staff_set_service_hours_enabled(text, boolean);
drop function if exists public.staff_set_last_order_buffer(text, int);
drop function if exists public.staff_set_service_focus(text, text, text, text);
drop function if exists public.staff_undo_service_focus(text);
drop function if exists public.rebroadcast_pending_advance_to_expert(uuid);
drop function if exists public.service_flags_sync();

-- 8. Drop new tables
drop table if exists public.service_notify_requests;
drop table if exists public.service_focus_snapshots;
drop table if exists public.service_hours_bypass_users;
drop table if exists public.service_holidays;
drop table if exists public.service_hours;

-- 9. Drop service_flags columns + sync trigger
drop trigger if exists trg_service_flags_sync on public.service_flags;
alter table public.service_flags
  drop column if exists status,
  drop column if exists status_message_en,
  drop column if exists status_message_mr,
  drop column if exists resume_at,
  drop column if exists hours_enabled,
  drop column if exists closed_today_date,
  drop column if exists closed_today_reason,
  drop column if exists closed_until,
  drop column if exists last_order_buffer_minutes,
  drop column if exists status_updated_at,
  drop column if exists status_updated_by;

-- 10. Drop bookings.last_rebroadcast_at and the ops_settings key
alter table public.bookings drop column if exists last_rebroadcast_at;
delete from public.ops_settings where key = 'advance_booking_expire_before_slot_hours';
