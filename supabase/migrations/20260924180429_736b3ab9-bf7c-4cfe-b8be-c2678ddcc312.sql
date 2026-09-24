ALTER TABLE public.courier_vehicle_rates
  ADD COLUMN customer_segment text NOT NULL DEFAULT 'regular' CHECK (customer_segment IN ('regular','corporate'));
ALTER TABLE public.courier_vehicle_rates ALTER COLUMN max_pickups DROP NOT NULL, ALTER COLUMN max_drops DROP NOT NULL;
ALTER TABLE public.courier_vehicle_rates ADD CONSTRAINT courier_vehicle_rates_regular_limits_check
  CHECK (customer_segment <> 'regular' OR (max_pickups IS NOT NULL AND max_drops IS NOT NULL));
ALTER TABLE public.courier_vehicle_rates DROP CONSTRAINT courier_vehicle_rates_city_vehicle_type_id_key;
CREATE UNIQUE INDEX courier_vehicle_rates_city_vehicle_segment_uidx
  ON public.courier_vehicle_rates (lower(trim(city)), vehicle_type_id, customer_segment);

CREATE OR REPLACE FUNCTION public.staff_courier_confirm_rate(_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _before jsonb;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  select to_jsonb(r) into _before from public.courier_vehicle_rates r where r.id=_id and r.customer_segment = 'regular';
  if _before is null then raise exception 'Rate not found'; end if;
  update public.courier_vehicle_rates set is_placeholder=false, updated_at=now() where id=_id and customer_segment = 'regular';
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_rate_confirm', 'courier_vehicle_rates', _id, _before,
          (select to_jsonb(r) from public.courier_vehicle_rates r where r.id=_id and r.customer_segment = 'regular'));
end $function$;

CREATE OR REPLACE FUNCTION public.store_courier_fare(_merchant_id uuid, _drop_lat numeric, _drop_lng numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _m record; _v record; _t record; _rate public.courier_vehicle_rates%rowtype;
        _km numeric; _base numeric; _sub numeric; _gst_pct numeric; _gst numeric; _total numeric; _key text;
begin
  select id, city, latitude, longitude into _m from public.merchants where id = _merchant_id;
  if _m.id is null or _m.latitude is null or _drop_lat is null then
    return jsonb_build_object('ok', false, 'code', 'delivery_unavailable'); end if;
  _key := lower(trim(coalesce(_m.city,'')));
  select vt.* into _v from public.courier_vehicle_types vt
    join public.courier_vehicle_rates r on r.vehicle_type_id = vt.id
     and lower(trim(coalesce(r.city,''))) = _key and not r.is_placeholder and r.customer_segment = 'regular'
   where vt.is_active order by vt.max_weight_kg, vt.sort_order limit 1;
  if _v.id is null then return jsonb_build_object('ok', false, 'code', 'delivery_unavailable'); end if;
  select ct.* into _t from public.courier_types ct
    join public.courier_vehicle_courier_types m on m.courier_type_id = ct.id and m.vehicle_type_id = _v.id and m.is_active
   where ct.is_active order by (lower(ct.name) = 'grocery') desc, (lower(ct.name) = 'other') desc, ct.sort_order limit 1;
  if _t.id is null then return jsonb_build_object('ok', false, 'code', 'delivery_unavailable'); end if;
  select * into _rate from public.courier_vehicle_rates
   where lower(trim(coalesce(city,''))) = _key and vehicle_type_id = _v.id and customer_segment = 'regular';

  _km := round(public.haversine_km(_m.latitude, _m.longitude, _drop_lat, _drop_lng)
               * coalesce(nullif(public.store_setting('store_courier_road_factor', 1.3),0),1.3), 2);
  if _km > public.store_max_radius_km() * 2 then
    return jsonb_build_object('ok', false, 'code', 'delivery_too_far'); end if;

  _base := round(greatest(_rate.min_fare, _rate.base_fare + greatest(0, _km - _rate.included_km) * _rate.per_km), 2);
  _sub := _base + _t.extra_fee + _rate.platform_fee;
  _gst_pct := public.get_gst_percent();
  _gst := round(_sub * _gst_pct / 100, 2);
  _total := round(_sub + _gst, 0);
  return jsonb_build_object('ok', true, 'city', _m.city, 'vehicle_type_id', _v.id, 'courier_type_id', _t.id,
    'distance_km', _km, 'distance_source', 'haversine', 'base_amount', _base, 'extra_fee', _t.extra_fee,
    'platform_fee', _rate.platform_fee, 'gst_percent', _gst_pct, 'gst_amount', _gst,
    'commission_pct', _rate.commission_pct, 'delivery_fee', _total);
end $function$;

CREATE OR REPLACE FUNCTION public.courier_quote_internal(_customer_id uuid, _city text, _vehicle_type_id uuid, _courier_type_id uuid, _distance_km numeric, _weight_kg numeric, _coupon_code text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  _rate public.courier_vehicle_rates%rowtype;
  _v public.courier_vehicle_types%rowtype;
  _t public.courier_types%rowtype;
  _base numeric; _gst_pct numeric; _gst numeric; _discount numeric := 0; _total numeric;
  _subtotal numeric; _limit int; _used int; _coupon jsonb; _ttl int;
  _key text;
begin
  if _customer_id is null then raise exception 'Not authenticated' using errcode='42501'; end if;

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
    'ok', true, 'city', _city, 'vehicle_type_id', _v.id, 'courier_type_id', _t.id,
    'distance_km', round(coalesce(_distance_km,0), 2), 'base_amount', _base,
    'extra_fee', _t.extra_fee, 'platform_fee', _rate.platform_fee,
    'discount_amount', _discount,
    'coupon_code', case when _discount > 0 then upper(trim(_coupon_code)) else null end,
    'coupon_id', case when _discount > 0 then _coupon->>'coupon_id' else null end,
    'commission_pct', _rate.commission_pct, 'gst_percent', _gst_pct, 'gst_amount', _gst,
    'total_amount', _total, 'quote_expires_at', now() + make_interval(mins => _ttl)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.staff_courier_upsert_rate(_id uuid, _city text, _vehicle_type_id uuid, _base_fare numeric, _included_km numeric, _per_km numeric, _min_fare numeric, _platform_fee numeric, _commission_pct numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _before jsonb; _rid uuid;
begin
  if not public.courier_is_super_admin() then raise exception 'Not authorized' using errcode='42501'; end if;
  if coalesce(btrim(_city),'') = '' then raise exception 'City required'; end if;
  if _vehicle_type_id is null then raise exception 'Vehicle type required'; end if;

  if _id is not null then
    select to_jsonb(r), r.id into _before, _rid from public.courier_vehicle_rates r where r.id=_id and r.customer_segment = 'regular';
    if _rid is null then raise exception 'Rate not found'; end if;
  else
    select to_jsonb(r), r.id into _before, _rid from public.courier_vehicle_rates r
     where lower(r.city)=lower(btrim(_city)) and r.vehicle_type_id=_vehicle_type_id and r.customer_segment = 'regular';
  end if;

  if _rid is null then
    insert into public.courier_vehicle_rates
      (city, vehicle_type_id, base_fare, included_km, per_km, min_fare, platform_fee, commission_pct)
    values (btrim(_city), _vehicle_type_id, coalesce(_base_fare,0), coalesce(_included_km,0),
            coalesce(_per_km,0), coalesce(_min_fare,0), coalesce(_platform_fee,0), coalesce(_commission_pct,0))
    returning id into _rid;
  else
    update public.courier_vehicle_rates set
      city=btrim(_city), vehicle_type_id=_vehicle_type_id,
      base_fare=coalesce(_base_fare,0), included_km=coalesce(_included_km,0),
      per_km=coalesce(_per_km,0), min_fare=coalesce(_min_fare,0),
      platform_fee=coalesce(_platform_fee,0), commission_pct=coalesce(_commission_pct,0),
      updated_at=now()
    where id=_rid and customer_segment = 'regular';
  end if;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), case when _before is null then 'courier_rate_create' else 'courier_rate_update' end,
          'courier_vehicle_rates', _rid, _before,
          (select to_jsonb(r) from public.courier_vehicle_rates r where r.id=_rid and r.customer_segment = 'regular'));
  return _rid;
end $function$;