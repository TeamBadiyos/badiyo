CREATE OR REPLACE FUNCTION public.courier_quote_internal(_customer_id uuid, _city text, _vehicle_type_id uuid, _courier_type_id uuid, _distance_km numeric, _weight_kg numeric, _coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
   where lower(trim(coalesce(city,''))) = _key and vehicle_type_id = _vehicle_type_id;
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
end $function$;

REVOKE ALL ON FUNCTION public.courier_quote_internal(uuid, text, uuid, uuid, numeric, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.courier_quote_internal(uuid, text, uuid, uuid, numeric, numeric, text) TO service_role;