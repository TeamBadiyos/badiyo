
-- settings
insert into public.ops_settings(key, value, label) values
  ('courier_location_read_per_min','12','Courier: rider location reads per minute'),
  ('courier_location_stale_seconds','120','Courier: rider location considered stale after (seconds)'),
  ('courier_fix_max_age_seconds','60','Courier: max GPS fix age at pickup (seconds)'),
  ('courier_fix_max_accuracy_m','100','Courier: max GPS accuracy at pickup (meters)'),
  ('courier_require_fresh_fix','0','Courier: require fresh GPS fix at pickup (1=on)'),
  ('courier_native_alert_enabled','0','Courier: native offer ring in rider app (1=on)'),
  ('courier_location_min_interval_seconds','15','Courier: minimum seconds between rider location saves')
on conflict (key) do nothing;

-- rate-limit log for location reads
create table if not exists public.courier_location_read_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists courier_location_read_log_cust_idx
  on public.courier_location_read_log (customer_id, created_at desc);
grant all on public.courier_location_read_log to service_role;
alter table public.courier_location_read_log enable row level security;
create policy "no direct access" on public.courier_location_read_log
  for select using (false);

-- 1. rider location for order owner
create or replace function public.courier_get_rider_location(_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _o public.courier_orders%rowtype; _e record; _lim int; _cnt int; _stale int;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;

  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then
    raise exception 'Forbidden' using errcode='42501';
  end if;

  if _o.status not in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')
     or _o.assigned_expert_id is null then
    return jsonb_build_object('available', false, 'reason', 'not_active');
  end if;

  _lim := public.courier_setting('courier_location_read_per_min', 12)::int;
  select count(*) into _cnt from public.courier_location_read_log
   where customer_id = auth.uid() and created_at > now() - interval '1 minute';
  if _cnt >= _lim then
    raise exception 'Too many location requests, please slow down' using errcode='P0001';
  end if;
  insert into public.courier_location_read_log(customer_id) values (auth.uid());

  select current_lat, current_lng, location_updated_at into _e
    from public.experts where id = _o.assigned_expert_id;

  if _e.current_lat is null or _e.current_lng is null then
    return jsonb_build_object('available', false, 'reason', 'no_fix');
  end if;

  _stale := public.courier_setting('courier_location_stale_seconds', 120)::int;
  return jsonb_build_object(
    'available', true,
    'lat', _e.current_lat,
    'lng', _e.current_lng,
    'location_updated_at', _e.location_updated_at,
    'stale', coalesce(_e.location_updated_at < now() - make_interval(secs => _stale), true)
  );
end $$;

revoke all on function public.courier_get_rider_location(uuid) from public, anon;
grant execute on function public.courier_get_rider_location(uuid) to authenticated, service_role;

-- 2. arrival with verified fresh fix
create or replace function public.courier_rider_advance(
  _order_id uuid, _to_status text, _lat numeric default null, _lng numeric default null,
  _accuracy_m numeric default null, _fix_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _eid uuid; _o public.courier_orders%rowtype; _geo numeric; _dist numeric; _otp text;
        _max_age int; _max_acc numeric; _require boolean; _age numeric; _reason text;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  if _to_status = 'ARRIVED_PICKUP' then
    if _o.status <> 'DRIVER_ASSIGNED' then raise exception 'Order is not in assigned state'; end if;

    _geo     := public.courier_setting('courier_geofence_meters', 200);
    _max_age := public.courier_setting('courier_fix_max_age_seconds', 60)::int;
    _max_acc := public.courier_setting('courier_fix_max_accuracy_m', 100);
    _require := public.courier_setting('courier_require_fresh_fix', 0) >= 1;

    if _lat is null or _lng is null then
      _reason := 'no_fix';
    elsif _fix_at is null or _accuracy_m is null then
      if _require then _reason := 'fix_metadata_missing'; end if;
    else
      _age := extract(epoch from (now() - _fix_at));
      if _age > _max_age or _age < -30 then
        _reason := 'fix_stale';
      elsif _accuracy_m > _max_acc then
        _reason := 'fix_inaccurate';
      end if;
    end if;

    if _reason is null then
      _dist := public.haversine_km(_lat, _lng, _o.pickup_lat, _o.pickup_lng) * 1000;
      if _dist > _geo then _reason := 'too_far_from_pickup'; end if;
    end if;

    if _reason is not null then
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_order_id, _o.status, _o.status, 'rider', _eid,
              jsonb_build_object('event','arrival_rejected','reason',_reason,
                                 'accuracy_m',_accuracy_m,'fix_at',_fix_at,'distance_m',_dist));
      return jsonb_build_object('ok', false, 'reason', _reason);
    end if;

    update public.courier_orders set status='ARRIVED_PICKUP', arrived_pickup_at=now() where id=_order_id;
    _otp := public.courier_issue_otp(_order_id, 'pickup');
    perform public.notify_customer_user_push(_o.customer_id, 'Rider reached pickup',
      'Share the pickup OTP with the rider to hand over the parcel.', 'home');
    return jsonb_build_object('ok', true, 'otp_issued', true);

  elsif _to_status = 'IN_TRANSIT' then
    if _o.status <> 'PICKED_UP' then raise exception 'Parcel has not been picked up yet'; end if;
    update public.courier_orders set status='IN_TRANSIT', in_transit_at=now() where id=_order_id;
    _otp := public.courier_issue_otp(_order_id, 'delivery');
    perform public.notify_customer_user_push(_o.customer_id, 'On the way',
      'Your parcel is on the way to the drop location.', 'home');
    return jsonb_build_object('ok', true, 'otp_issued', true);
  end if;

  raise exception 'Unsupported status %', _to_status;
end $$;

revoke all on function public.courier_rider_advance(uuid, text, numeric, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.courier_rider_advance(uuid, text, numeric, numeric, numeric, timestamptz) to authenticated, service_role;

-- 3+4. courier offer push payload with legacy-app safety flag
create or replace function public.courier_dispatch_next(_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare _o public.courier_orders%rowtype; _r record; _timeout int; _radius numeric;
        _offer public.courier_offers%rowtype; _earning numeric; _native boolean;
begin
  select * into _o from public.courier_orders where id = _order_id for update;
  if _o.id is null or _o.status <> 'SEARCHING' then return false; end if;
  if exists (select 1 from public.courier_offers
              where order_id = _order_id and status = 'pending' and expires_at > now()) then
    return true;
  end if;

  _timeout := public.courier_setting('courier_offer_timeout_seconds', 30)::int;
  _radius := coalesce(_o.current_search_radius_km,
                      (select broadcast_radius_km from public.dispatch_config limit 1), 5);

  select * into _r from public.courier_eligible_riders(_order_id, _radius) limit 1;
  if _r.expert_id is null then return false; end if;

  insert into public.courier_offers (order_id, expert_id, distance_km, expires_at)
  values (_order_id, _r.expert_id, _r.distance_km, now() + make_interval(secs => _timeout))
  on conflict (order_id, expert_id) do update
    set status = 'pending', sent_at = now(), expires_at = now() + make_interval(secs => _timeout)
  returning * into _offer;

  _earning := round(coalesce(_o.base_amount,0) + coalesce(_o.extra_fee,0)
                    - (coalesce(_o.base_amount,0) + coalesce(_o.extra_fee,0)) * coalesce(_o.commission_pct,0) / 100, 2);
  _native := public.courier_setting('courier_native_alert_enabled', 0) >= 1;

  perform public.notify_push_event(
    'expert', _r.expert_id,
    case when _native then 'courier_offer' else 'general' end,
    'New courier delivery',
    'Parcel pickup near ' || coalesce(split_part(_o.pickup_address, ',', 1), 'you') ||
      ' - you earn Rs ' || _earning::text,
    jsonb_build_object(
      'type','courier_offer',
      'order_id', _o.id,
      'offer_id', _offer.id,
      'expires_at', _offer.expires_at,
      'pickup_area', split_part(_o.pickup_address, ',', 1),
      'drop_area', split_part(_o.drop_address, ',', 1),
      'trip_km', _o.distance_km,
      'earning', _earning,
      'push_mode', case when _native then 'data' else 'notification' end
    ));
  return true;
end $$;

revoke all on function public.courier_dispatch_next(uuid) from public, anon, authenticated;
grant execute on function public.courier_dispatch_next(uuid) to service_role;

-- 5. throttle rider location writes
create or replace function public.expert_update_location(p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_expert_id uuid; v_last timestamptz; v_min int;
begin
  v_expert_id := public.get_expert_id_for_auth(auth.uid());
  if v_expert_id is null then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_lat is null or p_lng is null then raise exception 'Latitude and longitude are required'; end if;

  v_min := public.courier_setting('courier_location_min_interval_seconds', 15)::int;
  select location_updated_at into v_last from public.experts where id = v_expert_id;
  if v_last is not null and v_last > now() - make_interval(secs => v_min) then
    return;
  end if;

  update public.experts
     set current_lat = p_lat, current_lng = p_lng, location_updated_at = now()
   where id = v_expert_id;
end $$;

revoke all on function public.expert_update_location(numeric, numeric) from public, anon;
grant execute on function public.expert_update_location(numeric, numeric) to authenticated, service_role;
