CREATE OR REPLACE FUNCTION public.courier_create_order(_customer_id uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  -- New rule: multiple drops OR multiple pickups, never both (all segments)
  if _np > 1 and _nd > 1 then
    raise exception 'Choose either multiple drops or multiple pickups';
  end if;
  -- Exactly one parcel per extra-side stop (1 pickup -> one per drop; 1 drop -> one per pickup)
  if jsonb_array_length(_parcels) <> greatest(_np, _nd) then
    raise exception 'Each stop needs exactly one parcel';
  end if;

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