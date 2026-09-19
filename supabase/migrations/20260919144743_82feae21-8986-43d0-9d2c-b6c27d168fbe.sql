-- ===================== helpers =====================
create or replace function public.courier_setting(_key text, _default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value,'')::numeric from public.ops_settings where key = _key), _default)
$$;

create or replace function public.courier_otp_key()
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'courier_otp_hmac_key' limit 1
$$;

create or replace function public.courier_derive_otp(_order_id uuid, _purpose text, _issued_at timestamptz)
returns text language sql stable security definer set search_path = public, extensions as $$
  select lpad((
    ('x' || substr(encode(extensions.hmac(
        _order_id::text || ':' || _purpose || ':' || extract(epoch from _issued_at)::bigint::text,
        public.courier_otp_key(), 'sha256'), 'hex'), 1, 8))::bit(32)::bigint % 10000
  )::text, 4, '0')
$$;

create or replace function public.courier_hash_otp(_otp text)
returns text language sql immutable security definer set search_path = public, extensions as $$
  select encode(extensions.digest(_otp, 'sha256'), 'hex')
$$;

create or replace function public.courier_booking_start_at(_d date, _slot text)
returns timestamptz language plpgsql immutable set search_path = public as $$
declare _h int; _m int; _ampm text; _mt text[];
begin
  if _d is null then return null; end if;
  _mt := regexp_match(coalesce(_slot,''), '(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)');
  if _mt is null then
    return (_d + time '00:00') at time zone 'Asia/Kolkata';
  end if;
  _h := _mt[1]::int; _m := coalesce(_mt[2],'0')::int; _ampm := upper(_mt[3]);
  if _ampm = 'PM' and _h < 12 then _h := _h + 12; end if;
  if _ampm = 'AM' and _h = 12 then _h := 0; end if;
  return (_d + make_time(_h, _m, 0)) at time zone 'Asia/Kolkata';
end $$;

revoke execute on function public.courier_otp_key() from public, anon, authenticated;
revoke execute on function public.courier_derive_otp(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.courier_hash_otp(text) from public, anon, authenticated;
revoke execute on function public.courier_setting(text, numeric) from public, anon;
revoke execute on function public.courier_booking_start_at(date, text) from public, anon;

-- ===================== quote log (rate limiting) =====================
create table public.courier_quote_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  created_at timestamptz not null default now()
);
create index idx_courier_quote_log on public.courier_quote_log (customer_id, created_at desc);
revoke all on public.courier_quote_log from anon, authenticated;
grant all on public.courier_quote_log to service_role;
alter table public.courier_quote_log enable row level security;
create policy "quote log deny" on public.courier_quote_log for all to anon, authenticated using (false) with check (false);

-- ===================== quote (service_role only) =====================
create or replace function public.courier_quote_internal(
  _customer_id uuid, _city text, _vehicle_type_id uuid, _courier_type_id uuid,
  _distance_km numeric, _weight_kg numeric, _coupon_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _rate public.courier_vehicle_rates%rowtype;
  _v public.courier_vehicle_types%rowtype;
  _t public.courier_types%rowtype;
  _base numeric; _gst_pct numeric; _gst numeric; _discount numeric := 0; _total numeric;
  _subtotal numeric; _limit int; _used int; _coupon jsonb; _ttl int;
begin
  if _customer_id is null then raise exception 'Not authenticated' using errcode='42501'; end if;

  _limit := public.courier_setting('courier_quote_rate_limit_per_min', 10)::int;
  select count(*) into _used from public.courier_quote_log
   where customer_id = _customer_id and created_at > now() - interval '1 minute';
  if _used >= _limit then raise exception 'Too many quote requests, please wait a moment'; end if;
  insert into public.courier_quote_log (customer_id) values (_customer_id);

  if not exists (select 1 from public.service_flags
                  where service_key='courier' and city=_city and is_active) then
    raise exception 'Courier service is not available in % yet', _city;
  end if;

  select * into _v from public.courier_vehicle_types where id = _vehicle_type_id;
  if _v.id is null or not _v.is_active then raise exception 'This vehicle is not available'; end if;
  if coalesce(_weight_kg,0) > _v.max_weight_kg then
    raise exception 'Weight above the % kg limit for this vehicle', _v.max_weight_kg;
  end if;

  select * into _t from public.courier_types where id = _courier_type_id and is_active;
  if _t.id is null then raise exception 'This parcel type is not available'; end if;
  if not exists (select 1 from public.courier_vehicle_courier_types m
                  where m.vehicle_type_id = _v.id and m.courier_type_id = _t.id and m.is_active) then
    raise exception 'This parcel type cannot be sent on the selected vehicle';
  end if;

  select * into _rate from public.courier_vehicle_rates
   where city = _city and vehicle_type_id = _vehicle_type_id;
  if _rate.id is null then raise exception 'No rates configured for % yet', _city; end if;
  if _rate.is_placeholder then raise exception 'Courier pricing is not live yet'; end if;

  _base := greatest(_rate.min_fare,
             _rate.base_fare + greatest(0, coalesce(_distance_km,0) - _rate.included_km) * _rate.per_km);
  _base := round(_base, 2);
  _subtotal := _base + _t.extra_fee + _rate.platform_fee;

  if _coupon_code is not null and length(trim(_coupon_code)) > 0 then
    begin
      _coupon := public.coupon_preview(upper(trim(_coupon_code)), _subtotal, 0);
      if coalesce((_coupon->>'ok')::boolean, false) then
        _discount := least(_subtotal, coalesce((_coupon->>'discount')::numeric, 0));
      end if;
    exception when others then
      _coupon := null; _discount := 0;
    end;
  end if;

  _gst_pct := public.get_gst_percent();
  _gst := round((_subtotal - _discount) * _gst_pct / 100, 2);
  _total := round(_subtotal - _discount + _gst, 2);
  _ttl := public.courier_setting('courier_quote_ttl_minutes', 10)::int;

  return jsonb_build_object(
    'ok', true,
    'city', _city,
    'vehicle_type_id', _v.id,
    'courier_type_id', _t.id,
    'distance_km', round(coalesce(_distance_km,0), 2),
    'base_amount', _base,
    'extra_fee', _t.extra_fee,
    'platform_fee', _rate.platform_fee,
    'discount_amount', _discount,
    'coupon_code', case when _discount > 0 then upper(trim(_coupon_code)) else null end,
    'coupon_id', case when _discount > 0 then _coupon->>'coupon_id' else null end,
    'commission_pct', _rate.commission_pct,
    'gst_percent', _gst_pct,
    'gst_amount', _gst,
    'total_amount', _total,
    'quote_expires_at', now() + make_interval(mins => _ttl)
  );
end $$;

-- ===================== create order (service_role only) =====================
create or replace function public.courier_create_order(_customer_id uuid, _payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _q jsonb; _id uuid;
begin
  if _customer_id is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if coalesce((_payload->>'prohibited_items_confirmed')::boolean, false) is not true then
    raise exception 'Please confirm that the parcel has no prohibited items';
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

-- ===================== dispatch =====================
create or replace function public.courier_eligible_riders(_order_id uuid, _radius numeric)
returns table(expert_id uuid, distance_km numeric)
language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _skill uuid; _buffer int;
begin
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null then return; end if;
  select required_skill into _skill from public.courier_vehicle_types where id = _o.vehicle_type_id;
  _buffer := public.courier_setting('courier_slot_buffer_minutes', 90)::int;

  return query
  select e.id, public.haversine_km(e.current_lat, e.current_lng, _o.pickup_lat, _o.pickup_lng)
  from public.experts e
  where e.is_online = true
    and coalesce(e.is_busy,false) = false
    and e.status = 'active'
    and e.current_lat is not null and e.current_lng is not null
    and (e.location_updated_at is null or e.location_updated_at > now() - interval '15 minutes')
    and public.haversine_km(e.current_lat, e.current_lng, _o.pickup_lat, _o.pickup_lng) <= _radius
    and (_skill is null or exists (
      select 1 from public.partner_skills ps
      where ps.expert_id = e.id and ps.status = 'approved' and ps.service_category_id = _skill))
    and not exists (
      select 1 from public.courier_orders c
      where c.assigned_expert_id = e.id
        and c.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT'))
    and not exists (
      select 1 from public.bookings b
      where b.assigned_expert_id = e.id
        and b.status in ('confirmed','accepted','expert_assigned','in_progress')
        and b.deleted_at is null
        and public.courier_booking_start_at(b.scheduled_date, b.scheduled_time_slot)
              <= now() + make_interval(mins => _buffer))
    and not exists (
      select 1 from public.courier_offers o
      where o.order_id = _order_id and o.expert_id = e.id
        and o.status in ('pending','rejected','expired'))
  order by 2 asc;
end $$;

create or replace function public.courier_dispatch_next(_order_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _r record; _timeout int; _radius numeric;
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
    set status = 'pending', sent_at = now(), expires_at = now() + make_interval(secs => _timeout);

  perform public.notify_expert_broadcast(_r.expert_id, null::uuid,
    'New courier delivery',
    'A parcel pickup is available near you. Tap to accept.');
  return true;
end $$;

create or replace function public.courier_start_dispatch(_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.courier_orders
     set status = 'SEARCHING',
         search_started_at = now(),
         current_search_radius_km = coalesce(current_search_radius_km,
           (select broadcast_radius_km from public.dispatch_config limit 1), 5)
   where id = _order_id and status = 'REQUESTED' and payment_status = 'paid';
  perform public.courier_dispatch_next(_order_id);
end $$;

-- ===================== rider: offers =====================
create or replace function public.courier_rider_offers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _eid uuid;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'offer_id', f.id, 'order_id', o.id, 'order_code', o.order_code,
      'expires_at', f.expires_at, 'distance_to_pickup_km', round(f.distance_km,2),
      'pickup_area', split_part(o.pickup_address, ',', 1),
      'drop_area', split_part(o.drop_address, ',', 1),
      'trip_km', o.distance_km,
      'earning', round(o.base_amount + o.extra_fee - (o.base_amount + o.extra_fee) * o.commission_pct / 100, 2),
      'parcel', (select name from public.courier_types where id = o.courier_type_id)
    ) order by f.expires_at)
    from public.courier_offers f
    join public.courier_orders o on o.id = f.order_id
    where f.expert_id = _eid and f.status = 'pending' and f.expires_at > now()
      and o.status = 'SEARCHING'
  ), '[]'::jsonb);
end $$;

create or replace function public.courier_offer_respond(_offer_id uuid, _accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eid uuid; _f public.courier_offers%rowtype; _o public.courier_orders%rowtype;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;

  select * into _f from public.courier_offers
   where id = _offer_id and expert_id = _eid for update skip locked;
  if _f.id is null then return jsonb_build_object('ok', false, 'reason', 'offer_unavailable'); end if;
  if _f.status <> 'pending' or _f.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'offer_expired');
  end if;

  if not _accept then
    update public.courier_offers set status='rejected', responded_at=now() where id=_f.id;
    perform public.courier_dispatch_next(_f.order_id);
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;

  select * into _o from public.courier_orders where id = _f.order_id for update;
  if _o.status <> 'SEARCHING' or _o.assigned_expert_id is not null then
    update public.courier_offers set status='expired', responded_at=now() where id=_f.id;
    return jsonb_build_object('ok', false, 'reason', 'already_taken');
  end if;
  if exists (select 1 from public.courier_orders c
              where c.assigned_expert_id = _eid
                and c.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')) then
    return jsonb_build_object('ok', false, 'reason', 'already_on_a_job');
  end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  update public.courier_orders
     set status='DRIVER_ASSIGNED', assigned_expert_id=_eid, assigned_at=now()
   where id=_o.id;
  update public.courier_offers set status='accepted', responded_at=now() where id=_f.id;
  update public.courier_offers set status='cancelled'
   where order_id=_o.id and id <> _f.id and status='pending';
  update public.experts set is_busy = true where id = _eid;

  perform public.notify_customer_user_push(_o.customer_id, 'Rider assigned',
    'Your courier rider is on the way to pick up the parcel.', 'home');
  return jsonb_build_object('ok', true, 'accepted', true, 'order_id', _o.id);
end $$;

-- ===================== OTP =====================
create or replace function public.courier_issue_otp(_order_id uuid, _purpose text)
returns text language plpgsql security definer set search_path = public as $$
declare _issued timestamptz := date_trunc('second', now()); _otp text;
begin
  _otp := public.courier_derive_otp(_order_id, _purpose, _issued);
  insert into public.courier_order_secrets (order_id) values (_order_id) on conflict do nothing;
  if _purpose = 'pickup' then
    update public.courier_order_secrets
       set pickup_otp_hash = public.courier_hash_otp(_otp),
           pickup_otp_issued_at = _issued,
           pickup_otp_expires_at = now() + interval '12 hours',
           pickup_attempts = 0
     where order_id = _order_id;
  else
    update public.courier_order_secrets
       set delivery_otp_hash = public.courier_hash_otp(_otp),
           delivery_otp_issued_at = _issued,
           delivery_otp_expires_at = now() + interval '12 hours',
           delivery_attempts = 0
     where order_id = _order_id;
  end if;
  return _otp;
end $$;

create or replace function public.courier_get_otp(_order_id uuid, _purpose text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _s public.courier_order_secrets%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid OTP type'; end if;
  if _purpose = 'pickup' and _o.status not in ('ARRIVED_PICKUP') then
    raise exception 'Pickup OTP is available once the rider reaches the pickup point';
  end if;
  if _purpose = 'delivery' and _o.status not in ('IN_TRANSIT') then
    raise exception 'Delivery OTP is available once the parcel is in transit';
  end if;

  select * into _s from public.courier_order_secrets where order_id = _order_id;
  if _purpose = 'pickup' then
    if _s.pickup_otp_issued_at is null then raise exception 'OTP not generated yet'; end if;
    return jsonb_build_object('otp', public.courier_derive_otp(_order_id,'pickup',_s.pickup_otp_issued_at));
  else
    if _s.delivery_otp_issued_at is null then raise exception 'OTP not generated yet'; end if;
    return jsonb_build_object('otp', public.courier_derive_otp(_order_id,'delivery',_s.delivery_otp_issued_at));
  end if;
end $$;

create or replace function public.courier_verify_otp(_order_id uuid, _purpose text, _otp text, _proof_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eid uuid; _o public.courier_orders%rowtype; _s public.courier_order_secrets%rowtype;
        _hash text; _attempts int; _ok boolean;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id = _order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;

  select * into _s from public.courier_order_secrets where order_id = _order_id for update;
  if _s.locked_until is not null and _s.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if _purpose = 'pickup' then
    if _o.status <> 'ARRIVED_PICKUP' then raise exception 'Mark arrived at pickup first'; end if;
    _hash := _s.pickup_otp_hash; _attempts := _s.pickup_attempts;
    if _s.pickup_otp_expires_at is null or _s.pickup_otp_expires_at < now() then
      return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;
  else
    if _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;
    _hash := _s.delivery_otp_hash; _attempts := _s.delivery_attempts;
    if _s.delivery_otp_expires_at is null or _s.delivery_otp_expires_at < now() then
      return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;
  end if;

  _ok := _hash is not null and _hash = public.courier_hash_otp(coalesce(_otp,''));

  if not _ok then
    _attempts := _attempts + 1;
    if _purpose = 'pickup' then
      update public.courier_order_secrets set pickup_attempts = _attempts,
        locked_until = case when _attempts >= 5 then now() + interval '30 minutes' else locked_until end
       where order_id = _order_id;
    else
      update public.courier_order_secrets set delivery_attempts = _attempts,
        locked_until = case when _attempts >= 5 then now() + interval '30 minutes' else locked_until end
       where order_id = _order_id;
    end if;
    update public.courier_orders set otp_attempts = otp_attempts + 1,
           needs_ops_attention = (_attempts >= 5) or needs_ops_attention
     where id = _order_id;
    return jsonb_build_object('ok', false, 'reason', 'wrong_otp', 'attempts_left', greatest(0, 5 - _attempts));
  end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  if _purpose = 'pickup' then
    update public.courier_orders set status='PICKED_UP', picked_up_at=now() where id=_order_id;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel picked up',
      'Your parcel has been picked up.', 'home');
  else
    update public.courier_orders
       set status='DELIVERED', delivered_at=now(), proof_photo_url = coalesce(_proof_url, proof_photo_url)
     where id=_order_id;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel delivered',
      'Your parcel has been delivered successfully.', 'home');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ===================== rider: status =====================
create or replace function public.courier_rider_advance(_order_id uuid, _to_status text, _lat numeric default null, _lng numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eid uuid; _o public.courier_orders%rowtype; _geo numeric; _dist numeric; _otp text;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  if _to_status = 'ARRIVED_PICKUP' then
    if _o.status <> 'DRIVER_ASSIGNED' then raise exception 'Order is not in assigned state'; end if;
    _geo := public.courier_setting('courier_geofence_meters', 200);
    _dist := public.haversine_km(coalesce(_lat, -999), coalesce(_lng, -999), _o.pickup_lat, _o.pickup_lng) * 1000;
    if _lat is null or _lng is null or _dist > _geo then
      return jsonb_build_object('ok', false, 'reason', 'too_far_from_pickup');
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

create or replace function public.courier_rider_cancel(_order_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eid uuid; _o public.courier_orders%rowtype; _cap int;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status not in ('DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'Cannot cancel after the parcel is picked up — report an incident instead';
  end if;

  _cap := public.courier_setting('courier_rider_cancel_cap', 3)::int;
  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  update public.experts set is_busy=false where id=_eid;

  if _o.rider_cancel_count + 1 >= _cap then
    update public.courier_orders
       set status='SEARCHING', assigned_expert_id=null, assigned_at=null, arrived_pickup_at=null,
           rider_cancel_count = rider_cancel_count + 1, needs_ops_attention = true,
           cancel_reason_code = _reason
     where id=_order_id;
  else
    update public.courier_orders
       set status='SEARCHING', assigned_expert_id=null, assigned_at=null, arrived_pickup_at=null,
           rider_cancel_count = rider_cancel_count + 1, cancel_reason_code = _reason
     where id=_order_id;
    perform public.courier_dispatch_next(_order_id);
  end if;

  perform public.notify_customer_user_push(_o.customer_id, 'Finding another rider',
    'Your rider could not continue. We are assigning a new rider.', 'home');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.courier_report_incident(_order_id uuid, _code text, _notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _eid uuid; _o public.courier_orders%rowtype;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status not in ('PICKED_UP','IN_TRANSIT') then raise exception 'Incidents can be raised only after pickup'; end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);
  update public.courier_orders
     set status='FAILED_DELIVERY', incident_code=_code, incident_notes=_notes, needs_ops_attention=true
   where id=_order_id;

  perform public.notify_customer_user_push(_o.customer_id, 'Delivery could not be completed',
    'Our team is looking into it and will contact you shortly.', 'home');
  return jsonb_build_object('ok', true);
end $$;

-- ===================== refunds / settlement =====================
create or replace function public.courier_mark_refund_pending(_order_id uuid, _amount numeric, _reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.courier_orders
     set refund_status = case when _amount > 0 then 'refund_pending' else 'none' end,
         refund_amount = greatest(0, _amount),
         refund_reason = _reason,
         refund_next_attempt_at = now(),
         payment_status = case when _amount > 0 and payment_status = 'paid' then 'refund_pending' else payment_status end
   where id = _order_id;
end $$;

create or replace function public.courier_settle_order(_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _earn numeric; _pct numeric;
begin
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.earnings_credited_at is not null then return; end if;

  if _o.status = 'DELIVERED' then
    update public.courier_orders set status='COMPLETED', completed_at=now() where id=_o.id;
    _earn := round((_o.base_amount + _o.extra_fee) * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'FAILED_DELIVERY' then
    _pct := public.courier_setting('courier_failed_delivery_payout_pct', 50);
    _earn := round(_o.base_amount * _pct / 100 * (100 - _o.commission_pct) / 100, 2);
  else
    return;
  end if;

  if _o.assigned_expert_id is not null and _earn > 0 then
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
    values ('expert', _o.assigned_expert_id, _earn, 'credit', 'courier_order:' || _o.id::text);
    update public.experts set wallet_balance = coalesce(wallet_balance,0) + _earn, is_busy = false
     where id = _o.assigned_expert_id;
    perform public.notify_expert_push(_o.assigned_expert_id, 'Earning credited',
      'Rs ' || _earn::text || ' added to your wallet for a courier delivery.', 'wallet');
  end if;

  update public.courier_orders set earnings_credited_at = now() where id = _o.id;
end $$;

-- ===================== customer cancel =====================
create or replace function public.courier_cancel_order(_order_id uuid, _reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _fee numeric := 0; _refund numeric := 0; _cap numeric;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status not in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
    raise exception 'This order can no longer be cancelled';
  end if;

  if _o.status = 'ARRIVED_PICKUP' then
    _fee := public.courier_setting('courier_cancel_fee_arrived', 30);
    _cap := round(_o.base_amount * public.courier_setting('courier_cancel_fee_max_pct', 50) / 100, 2);
    _fee := least(_fee, greatest(_cap, 0));
  end if;

  if _o.payment_status in ('paid','refund_pending') then
    _refund := greatest(0, _o.total_amount - _fee);
  end if;

  perform set_config('app.courier_actor_type','customer',true);
  perform set_config('app.courier_actor_id', _o.customer_id::text, true);

  update public.courier_orders
     set status='CANCELLED', cancelled_by='customer', cancelled_at=now(),
         cancel_reason_code = coalesce(_reason,'customer_cancelled'),
         cancellation_fee = _fee
   where id=_order_id;

  update public.courier_offers set status='cancelled' where order_id=_order_id and status='pending';

  if _o.assigned_expert_id is not null then
    update public.experts set is_busy=false where id=_o.assigned_expert_id;
    if _fee > 0 then
      insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
      values ('expert', _o.assigned_expert_id, _fee, 'credit', 'courier_cancel_fee:' || _o.id::text);
      update public.experts set wallet_balance = coalesce(wallet_balance,0) + _fee
       where id = _o.assigned_expert_id;
    end if;
    perform public.notify_expert_alert(_o.assigned_expert_id, 'order_cancelled', 'Courier cancelled',
      'The courier order assigned to you was cancelled.', jsonb_build_object('order_id', _o.id));
  end if;

  perform public.courier_mark_refund_pending(_order_id, _refund, 'customer_cancelled');
  perform public.notify_customer_user_push(_o.customer_id, 'Courier cancelled',
    case when _refund > 0 then 'Refund of Rs ' || _refund::text || ' is being processed.'
         else 'Your courier order was cancelled.' end, 'home');
  return jsonb_build_object('ok', true, 'cancellation_fee', _fee, 'refund_amount', _refund);
end $$;

-- ===================== sweeper =====================
create or replace function public.courier_sweeper()
returns void language plpgsql security definer set search_path = public as $$
declare _r record; _timeout int; _expire int; _delay int; _step numeric; _max numeric;
begin
  begin
    _timeout := public.courier_setting('courier_search_timeout_minutes', 5)::int;
    _expire  := public.courier_setting('courier_unpaid_expire_minutes', 15)::int;
    _delay   := public.courier_setting('courier_settlement_delay_minutes', 0)::int;
    select coalesce(radius_expand_step_km,1), coalesce(radius_expand_max_km,10)
      into _step, _max from public.dispatch_config limit 1;
    _step := coalesce(_step,1); _max := coalesce(_max,10);

    -- expire stale offers
    update public.courier_offers set status='expired', responded_at=now()
     where status='pending' and expires_at <= now();

    -- unpaid requested orders
    for _r in select id, customer_id from public.courier_orders
               where status='REQUESTED' and payment_status='pending'
                 and created_at < now() - make_interval(mins => _expire)
    loop
      perform set_config('app.courier_actor_type','system',true);
      update public.courier_orders
         set status='CANCELLED', cancelled_by='system', cancelled_at=now(),
             cancel_reason_code='unpaid_expired'
       where id=_r.id;
    end loop;

    -- searching: expand radius / keep dispatching / timeout
    for _r in select id, customer_id, search_started_at, current_search_radius_km
                from public.courier_orders where status='SEARCHING'
    loop
      if _r.search_started_at is not null
         and _r.search_started_at < now() - make_interval(mins => _timeout) then
        perform set_config('app.courier_actor_type','system',true);
        update public.courier_orders
           set status='CANCELLED', cancelled_by='system', cancelled_at=now(),
               cancel_reason_code='no_rider_found'
         where id=_r.id;
        update public.courier_offers set status='cancelled' where order_id=_r.id and status='pending';
        perform public.courier_mark_refund_pending(_r.id,
          (select total_amount from public.courier_orders where id=_r.id), 'no_rider_found');
        perform public.notify_customer_user_push(_r.customer_id, 'No rider available',
          'We could not find a rider. Your payment is being refunded.', 'home');
      else
        if not exists (select 1 from public.courier_offers
                        where order_id=_r.id and status='pending' and expires_at > now()) then
          update public.courier_orders
             set current_search_radius_km = least(_max, coalesce(current_search_radius_km, 5) + _step)
           where id=_r.id;
          perform public.courier_dispatch_next(_r.id);
        end if;
      end if;
    end loop;

    -- settle delivered orders
    for _r in select id from public.courier_orders
               where status='DELIVERED' and earnings_credited_at is null
                 and delivered_at < now() - make_interval(mins => _delay)
    loop
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;

  exception when others then
    raise warning 'courier_sweeper failed: %', sqlerrm;
  end;
end $$;

-- ===================== staff RPCs =====================
create or replace function public.staff_courier_force_cancel(_order_id uuid, _reason text, _refund_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _o public.courier_orders%rowtype; _before jsonb; _refund numeric;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  _before := to_jsonb(_o);

  _refund := coalesce(_refund_amount, case when _o.payment_status in ('paid','refund_pending') then _o.total_amount else 0 end);
  perform set_config('app.courier_actor_type','staff',true);
  update public.courier_orders
     set status='CANCELLED', cancelled_by='staff', cancelled_at=now(),
         cancel_reason_code=coalesce(_reason,'staff_cancelled'), needs_ops_attention=false
   where id=_order_id;
  update public.courier_offers set status='cancelled' where order_id=_order_id and status='pending';
  if _o.assigned_expert_id is not null then
    update public.experts set is_busy=false where id=_o.assigned_expert_id;
  end if;
  perform public.courier_mark_refund_pending(_order_id, _refund, 'staff_cancelled');

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_force_cancel', 'courier_orders', _order_id, _before,
          (select to_jsonb(c) from public.courier_orders c where c.id=_order_id));
  return jsonb_build_object('ok', true, 'refund_amount', _refund);
end $$;

create or replace function public.staff_courier_reassign_rider(_order_id uuid, _expert_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _before jsonb; _old uuid;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(c), c.assigned_expert_id into _before, _old from public.courier_orders c where c.id=_order_id for update;
  if _before is null then raise exception 'Order not found'; end if;

  perform set_config('app.courier_actor_type','staff',true);
  if _old is not null then update public.experts set is_busy=false where id=_old; end if;
  update public.courier_orders set assigned_expert_id=_expert_id, assigned_at=now(), needs_ops_attention=false
   where id=_order_id;
  update public.experts set is_busy=true where id=_expert_id;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_reassign_rider', 'courier_orders', _order_id, _before,
          (select to_jsonb(c) from public.courier_orders c where c.id=_order_id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_courier_refund(_order_id uuid, _amount numeric, _reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _before jsonb;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(c) into _before from public.courier_orders c where c.id=_order_id;
  if _before is null then raise exception 'Order not found'; end if;
  perform public.courier_mark_refund_pending(_order_id, _amount, coalesce(_reason,'staff_refund'));
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_refund', 'courier_orders', _order_id, _before,
          (select to_jsonb(c) from public.courier_orders c where c.id=_order_id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_courier_resolve_incident(_order_id uuid, _resolution text, _refund_amount numeric default 0, _pay_rider boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _before jsonb; _status text;
begin
  if not public.courier_is_ops_staff() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(c), c.status into _before, _status from public.courier_orders c where c.id=_order_id for update;
  if _before is null then raise exception 'Order not found'; end if;
  if _status <> 'FAILED_DELIVERY' then raise exception 'Order is not in an incident state'; end if;

  perform set_config('app.courier_actor_type','staff',true);
  update public.courier_orders set incident_resolution=_resolution, needs_ops_attention=false where id=_order_id;
  if _pay_rider then perform public.courier_settle_order(_order_id); end if;
  if coalesce(_refund_amount,0) > 0 then
    perform public.courier_mark_refund_pending(_order_id, _refund_amount, 'incident_resolution');
  end if;
  update public.courier_orders set status='COMPLETED', completed_at=now()
   where id=_order_id and status='FAILED_DELIVERY';

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_resolve_incident', 'courier_orders', _order_id, _before,
          (select to_jsonb(c) from public.courier_orders c where c.id=_order_id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_courier_set_service_flag(_service_key text, _city text, _is_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _before jsonb; _id uuid;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(f), f.id into _before, _id from public.service_flags f
   where f.service_key=_service_key and f.city=_city;
  if _id is null then raise exception 'Service flag not found'; end if;
  update public.service_flags set is_active=_is_active where id=_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'set_service_flag', 'service_flags', _id, _before,
          (select to_jsonb(f) from public.service_flags f where f.id=_id));
  return jsonb_build_object('ok', true);
end $$;

-- ===================== grants =====================
-- internal / service-role only
revoke execute on function
  public.courier_quote_internal(uuid, text, uuid, uuid, numeric, numeric, text),
  public.courier_create_order(uuid, jsonb),
  public.courier_eligible_riders(uuid, numeric),
  public.courier_dispatch_next(uuid),
  public.courier_start_dispatch(uuid),
  public.courier_issue_otp(uuid, text),
  public.courier_mark_refund_pending(uuid, numeric, text),
  public.courier_settle_order(uuid),
  public.courier_sweeper()
from public, anon, authenticated;

grant execute on function
  public.courier_quote_internal(uuid, text, uuid, uuid, numeric, numeric, text),
  public.courier_create_order(uuid, jsonb),
  public.courier_eligible_riders(uuid, numeric),
  public.courier_dispatch_next(uuid),
  public.courier_start_dispatch(uuid),
  public.courier_issue_otp(uuid, text),
  public.courier_mark_refund_pending(uuid, numeric, text),
  public.courier_settle_order(uuid),
  public.courier_sweeper()
to service_role;

-- app-facing
revoke execute on function
  public.courier_rider_offers(),
  public.courier_offer_respond(uuid, boolean),
  public.courier_rider_advance(uuid, text, numeric, numeric),
  public.courier_rider_cancel(uuid, text),
  public.courier_report_incident(uuid, text, text),
  public.courier_verify_otp(uuid, text, text, text),
  public.courier_get_otp(uuid, text),
  public.courier_cancel_order(uuid, text),
  public.staff_courier_force_cancel(uuid, text, numeric),
  public.staff_courier_reassign_rider(uuid, uuid),
  public.staff_courier_refund(uuid, numeric, text),
  public.staff_courier_resolve_incident(uuid, text, numeric, boolean),
  public.staff_courier_set_service_flag(text, text, boolean)
from public, anon;

grant execute on function
  public.courier_rider_offers(),
  public.courier_offer_respond(uuid, boolean),
  public.courier_rider_advance(uuid, text, numeric, numeric),
  public.courier_rider_cancel(uuid, text),
  public.courier_report_incident(uuid, text, text),
  public.courier_verify_otp(uuid, text, text, text),
  public.courier_get_otp(uuid, text),
  public.courier_cancel_order(uuid, text),
  public.staff_courier_force_cancel(uuid, text, numeric),
  public.staff_courier_reassign_rider(uuid, uuid),
  public.staff_courier_refund(uuid, numeric, text),
  public.staff_courier_resolve_incident(uuid, text, numeric, boolean),
  public.staff_courier_set_service_flag(text, text, boolean)
to authenticated, service_role;