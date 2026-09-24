DROP FUNCTION public.courier_quote_internal(uuid,text,uuid,uuid,numeric,numeric,text);

CREATE FUNCTION public.courier_quote_internal(_customer_id uuid, _city text, _vehicle_type_id uuid, _courier_type_id uuid, _distance_km numeric, _weight_kg numeric, _coupon_code text DEFAULT NULL::text, _pickup_count integer DEFAULT 1, _drop_count integer DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  _rate public.courier_vehicle_rates%rowtype;
  _v public.courier_vehicle_types%rowtype;
  _t public.courier_types%rowtype;
  _base numeric; _gst_pct numeric; _gst numeric; _discount numeric := 0; _total numeric;
  _subtotal numeric; _limit int; _used int; _coupon jsonb; _ttl int;
  _key text; _stops_fee numeric;
begin
  if _customer_id is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  _pickup_count := coalesce(_pickup_count, 1); _drop_count := coalesce(_drop_count, 1);
  if _pickup_count < 1 then raise exception 'At least 1 pickup is required'; end if;
  if _drop_count < 1 then raise exception 'At least 1 drop is required'; end if;

  _limit := public.courier_setting('courier_quote_rate_limit_per_min', 10)::int;
  select count(*) into _used from public.courier_quote_log
   where customer_id = _customer_id and created_at > now() - interval '1 minute';
  if _used >= _limit then raise exception 'Too many quote requests, please wait a moment'; end if;
  insert into public.courier_quote_log (customer_id) values (_customer_id);

  _key := lower(trim(coalesce(_city, '')));

  if not exists (select 1 from public.service_flags
                  where service_key='courier' and lower(trim(coalesce(city,''))) = _key and is_active) then
    raise exception 'Parcel delivery is not available in your area yet';
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
   where lower(trim(coalesce(city,''))) = _key and vehicle_type_id = _vehicle_type_id and customer_segment = 'regular';
  if _rate.id is null then raise exception 'Parcel delivery is not available in your area yet'; end if;
  if _rate.is_placeholder then raise exception 'Parcel delivery is not available in your area yet'; end if;

  if _rate.max_pickups is not null and _pickup_count > _rate.max_pickups then
    raise exception 'Maximum % pickups allowed', _rate.max_pickups;
  end if;
  if _rate.max_drops is not null and _drop_count > _rate.max_drops then
    raise exception 'Maximum % drops allowed', _rate.max_drops;
  end if;

  _base := greatest(_rate.min_fare,
             _rate.base_fare + greatest(0, coalesce(_distance_km,0) - _rate.included_km) * _rate.per_km);
  _base := round(_base, 2);
  _stops_fee := round(coalesce(_rate.extra_pickup_fee,0) * (_pickup_count - 1)
                    + coalesce(_rate.extra_drop_fee,0) * (_drop_count - 1), 2);
  _subtotal := _base + _t.extra_fee + _rate.platform_fee + _stops_fee;

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
    'ok', true, 'city', _city, 'vehicle_type_id', _v.id, 'courier_type_id', _t.id,
    'distance_km', round(coalesce(_distance_km,0), 2), 'base_amount', _base,
    'extra_fee', _t.extra_fee, 'platform_fee', _rate.platform_fee,
    'discount_amount', _discount,
    'coupon_code', case when _discount > 0 then upper(trim(_coupon_code)) else null end,
    'coupon_id', case when _discount > 0 then _coupon->>'coupon_id' else null end,
    'commission_pct', _rate.commission_pct, 'gst_percent', _gst_pct, 'gst_amount', _gst,
    'total_amount', _total, 'quote_expires_at', now() + make_interval(mins => _ttl),
    'pickup_count', _pickup_count, 'drop_count', _drop_count, 'stops_fee', _stops_fee
  );
end $function$;

REVOKE ALL ON FUNCTION public.courier_quote_internal(uuid,text,uuid,uuid,numeric,numeric,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_quote_internal(uuid,text,uuid,uuid,numeric,numeric,text,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.courier_plan_stops(_stops jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare
  _pickups jsonb := '[]'; _drops jsonb := '[]'; _out jsonb := '[]';
  _cur jsonb; _best int; _bestd numeric; _d numeric; i int; _s jsonb;
begin
  if _stops is null or jsonb_typeof(_stops) <> 'array' then raise exception 'Stops must be a list'; end if;
  for _s in select value from jsonb_array_elements(_stops) loop
    if _s->>'type' = 'pickup' then _pickups := _pickups || jsonb_build_array(_s);
    elsif _s->>'type' = 'drop' then _drops := _drops || jsonb_build_array(_s);
    else raise exception 'Each stop must be a pickup or a drop'; end if;
  end loop;
  if jsonb_array_length(_pickups) = 0 then return _drops; end if;

  _cur := _pickups->0; _out := jsonb_build_array(_cur); _pickups := _pickups - 0;
  while jsonb_array_length(_pickups) > 0 loop
    _best := 0; _bestd := null;
    for i in 0 .. jsonb_array_length(_pickups)-1 loop
      _d := public.haversine_km((_cur->>'lat')::numeric,(_cur->>'lng')::numeric,(_pickups->i->>'lat')::numeric,(_pickups->i->>'lng')::numeric);
      if _bestd is null or _d < _bestd then _bestd := _d; _best := i; end if;
    end loop;
    _cur := _pickups->_best; _out := _out || jsonb_build_array(_cur); _pickups := _pickups - _best;
  end loop;
  while jsonb_array_length(_drops) > 0 loop
    _best := 0; _bestd := null;
    for i in 0 .. jsonb_array_length(_drops)-1 loop
      _d := public.haversine_km((_cur->>'lat')::numeric,(_cur->>'lng')::numeric,(_drops->i->>'lat')::numeric,(_drops->i->>'lng')::numeric);
      if _bestd is null or _d < _bestd then _bestd := _d; _best := i; end if;
    end loop;
    _cur := _drops->_best; _out := _out || jsonb_build_array(_cur); _drops := _drops - _best;
  end loop;
  return _out;
end $function$;
REVOKE ALL ON FUNCTION public.courier_plan_stops(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_plan_stops(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.courier_min_route_km(_stops jsonb)
 RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $function$
declare _sum numeric := 0; i int;
begin
  if _stops is null or jsonb_typeof(_stops) <> 'array' or jsonb_array_length(_stops) < 2 then return 0; end if;
  for i in 1 .. jsonb_array_length(_stops)-1 loop
    _sum := _sum + public.haversine_km((_stops->(i-1)->>'lat')::numeric,(_stops->(i-1)->>'lng')::numeric,
                                       (_stops->i->>'lat')::numeric,(_stops->i->>'lng')::numeric);
  end loop;
  return _sum;
end $function$;
REVOKE ALL ON FUNCTION public.courier_min_route_km(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_min_route_km(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.courier_create_order(_customer_id uuid, _payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _q jsonb; _id uuid; _route jsonb; _st jsonb;
  _stops jsonb; _parcels jsonb; _s jsonb; _p jsonb; _o jsonb;
  _np int := 0; _nd int := 0; _seen_drop boolean := false; _keys text[] := '{}';
  _ptype jsonb := '{}'; _used text[] := '{}'; _fp jsonb; _fd jsonb; _i int; _j int;
  _stop_ids jsonb := '{}'; _sid uuid; _phone text; _pk jsonb; _dk jsonb;
begin
  if _customer_id is null then raise exception 'Not authenticated' using errcode='42501'; end if;

  if not public.service_hours_bypass() then
    _st := public.service_effective_state('courier');
    if not coalesce((_st->>'can_order')::boolean, true) then
      raise exception 'SERVICE_CLOSED:%:%', _st->>'reason_code', coalesce(_st->>'next_open_at', '')
        using errcode = 'check_violation';
    end if;
  end if;

  if coalesce((_payload->>'prohibited_items_confirmed')::boolean, false) is not true then
    raise exception 'Please confirm that the parcel has no prohibited items';
  end if;

  -- ===== Legacy single pickup / single drop path =====
  if _payload->'stops' is null or jsonb_typeof(_payload->'stops') <> 'array' then
    _route := public.courier_validate_local_route(
      _payload->>'city',
      (_payload->>'pickup_lat')::numeric, (_payload->>'pickup_lng')::numeric,
      (_payload->>'drop_lat')::numeric, (_payload->>'drop_lng')::numeric);
    if not coalesce((_route->>'ok')::boolean, false) then
      raise exception '%', _route->>'message';
    end if;

    if coalesce((_payload->>'distance_km')::numeric, 0) <
       public.courier_min_route_km(jsonb_build_array(
         jsonb_build_object('lat', _payload->'pickup_lat', 'lng', _payload->'pickup_lng'),
         jsonb_build_object('lat', _payload->'drop_lat', 'lng', _payload->'drop_lng'))) * 0.95 - 0.2 then
      raise exception 'DISTANCE_MISMATCH';
    end if;

    _q := public.courier_quote_internal(
      _customer_id, _payload->>'city',
      (_payload->>'vehicle_type_id')::uuid, (_payload->>'courier_type_id')::uuid,
      (_payload->>'distance_km')::numeric, coalesce((_payload->>'weight_kg')::numeric, 0),
      _payload->>'coupon_code');

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
  end if;

  -- ===== Multi-stop path =====
  _stops := _payload->'stops';
  _parcels := coalesce(_payload->'parcels', '[]'::jsonb);
  if jsonb_typeof(_parcels) <> 'array' or jsonb_array_length(_parcels) = 0 then
    raise exception 'Please add at least one parcel';
  end if;

  for _s in select value from jsonb_array_elements(_stops) loop
    if coalesce(_s->>'key','') = '' then raise exception 'Every stop needs a key'; end if;
    if (_s->>'key') = any(_keys) then raise exception 'Stop % appears more than once', _s->>'key'; end if;
    _keys := _keys || (_s->>'key');
    if _s->>'type' = 'pickup' then
      if _seen_drop then raise exception 'All pickups must come before the drops'; end if;
      _np := _np + 1; if _fp is null then _fp := _s; end if;
    elsif _s->>'type' = 'drop' then
      _seen_drop := true; _nd := _nd + 1; if _fd is null then _fd := _s; end if;
    else raise exception 'Each stop must be a pickup or a drop'; end if;
    if (_s->>'lat') is null or (_s->>'lng') is null then raise exception 'Every stop needs a location'; end if;
    if coalesce(trim(_s->>'address'),'') = '' then raise exception 'Every stop needs an address'; end if;
    if coalesce(trim(_s->>'contact_name'),'') = '' then raise exception 'Every stop needs a contact name'; end if;
    _phone := right(regexp_replace(coalesce(_s->>'contact_phone',''), '\D', '', 'g'), 10);
    if _phone !~ '^[6-9][0-9]{9}$' then
      raise exception 'Please enter a valid 10-digit mobile number for every stop';
    end if;
    _ptype := _ptype || jsonb_build_object(_s->>'key', _s);
  end loop;
  if _np < 1 then raise exception 'At least 1 pickup is required'; end if;
  if _nd < 1 then raise exception 'At least 1 drop is required'; end if;

  -- no two pickups within 50 m
  for _i in 0 .. jsonb_array_length(_stops)-1 loop
    for _j in _i+1 .. jsonb_array_length(_stops)-1 loop
      if _stops->_i->>'type'='pickup' and _stops->_j->>'type'='pickup' and
         public.haversine_km((_stops->_i->>'lat')::numeric,(_stops->_i->>'lng')::numeric,
                             (_stops->_j->>'lat')::numeric,(_stops->_j->>'lng')::numeric) <= 0.05 then
        raise exception 'Two pickup points are too close to each other';
      end if;
    end loop;
  end loop;

  for _p in select value from jsonb_array_elements(_parcels) loop
    _pk := _ptype->(_p->>'pickup_key'); _dk := _ptype->(_p->>'drop_key');
    if _pk is null or _pk->>'type' <> 'pickup' then raise exception 'A parcel has an unknown pickup'; end if;
    if _dk is null or _dk->>'type' <> 'drop' then raise exception 'A parcel has an unknown drop'; end if;
    if public.haversine_km((_pk->>'lat')::numeric,(_pk->>'lng')::numeric,(_dk->>'lat')::numeric,(_dk->>'lng')::numeric) <= 0.05 then
      raise exception 'A parcel''s pickup and drop are too close to each other';
    end if;
    _route := public.courier_validate_local_route(_payload->>'city',
      (_pk->>'lat')::numeric,(_pk->>'lng')::numeric,(_dk->>'lat')::numeric,(_dk->>'lng')::numeric);
    if not coalesce((_route->>'ok')::boolean, false) then raise exception '%', _route->>'message'; end if;
    _used := _used || (_p->>'pickup_key') || (_p->>'drop_key');
  end loop;
  foreach _o in array array(select value from jsonb_array_elements(_stops)) loop
    if not ((_o->>'key') = any(_used)) then raise exception 'Stop % is not used by any parcel', _o->>'key'; end if;
  end loop;

  if coalesce((_payload->>'distance_km')::numeric, 0) < public.courier_min_route_km(_stops) * 0.95 - 0.2 then
    raise exception 'DISTANCE_MISMATCH';
  end if;

  _q := public.courier_quote_internal(
    _customer_id, _payload->>'city',
    (_payload->>'vehicle_type_id')::uuid, (_payload->>'courier_type_id')::uuid,
    (_payload->>'distance_km')::numeric, coalesce((_payload->>'weight_kg')::numeric, 0),
    _payload->>'coupon_code', _np, _nd);

  perform set_config('app.courier_skip_default_stops', 'on', true);

  insert into public.courier_orders (
    customer_id, city, vehicle_type_id, courier_type_id,
    pickup_lat, pickup_lng, pickup_address, pickup_contact_name, pickup_contact_phone,
    drop_lat, drop_lng, drop_address, drop_contact_name, drop_contact_phone,
    package_description, weight_kg, prohibited_items_confirmed,
    distance_km, distance_source, fare_breakdown, quote_expires_at,
    base_amount, extra_fee, platform_fee, discount_amount, coupon_id, coupon_code,
    gst_percent, gst_amount, total_amount, commission_pct, status,
    pickup_count, drop_count, stops_fee
  ) values (
    _customer_id, _payload->>'city', (_payload->>'vehicle_type_id')::uuid, (_payload->>'courier_type_id')::uuid,
    (_fp->>'lat')::numeric, (_fp->>'lng')::numeric, _fp->>'address', _fp->>'contact_name', _fp->>'contact_phone',
    (_fd->>'lat')::numeric, (_fd->>'lng')::numeric, _fd->>'address', _fd->>'contact_name', _fd->>'contact_phone',
    coalesce(_payload->>'package_description', _parcels->0->>'description'),
    coalesce((_payload->>'weight_kg')::numeric,0), true,
    (_q->>'distance_km')::numeric, coalesce(_payload->>'distance_source','routes'), _q,
    (_q->>'quote_expires_at')::timestamptz,
    (_q->>'base_amount')::numeric, (_q->>'extra_fee')::numeric, (_q->>'platform_fee')::numeric,
    (_q->>'discount_amount')::numeric, nullif(_q->>'coupon_id','')::uuid, _q->>'coupon_code',
    (_q->>'gst_percent')::numeric, (_q->>'gst_amount')::numeric, (_q->>'total_amount')::numeric,
    (_q->>'commission_pct')::numeric, 'REQUESTED',
    _np, _nd, (_q->>'stops_fee')::numeric
  ) returning id into _id;

  perform set_config('app.courier_skip_default_stops', 'off', true);

  for _i in 0 .. jsonb_array_length(_stops)-1 loop
    _s := _stops->_i;
    insert into public.courier_order_stops (order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone)
    values (_id, _s->>'type', _i+1, (_s->>'lat')::numeric, (_s->>'lng')::numeric,
            _s->>'address', _s->>'contact_name', _s->>'contact_phone')
    returning id into _sid;
    _stop_ids := _stop_ids || jsonb_build_object(_s->>'key', _sid);
  end loop;

  for _p in select value from jsonb_array_elements(_parcels) loop
    insert into public.courier_order_parcels (order_id, pickup_stop_id, drop_stop_id, description)
    values (_id, (_stop_ids->>(_p->>'pickup_key'))::uuid, (_stop_ids->>(_p->>'drop_key'))::uuid, _p->>'description');
  end loop;

  return jsonb_build_object('ok', true, 'order_id', _id, 'quote', _q, 'stop_ids', _stop_ids);
end $function$;

REVOKE ALL ON FUNCTION public.courier_create_order(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_create_order(uuid,jsonb) TO service_role;