CREATE OR REPLACE FUNCTION public.store_courier_fare(_merchant_id uuid, _drop_lat numeric, _drop_lng numeric)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _m record; _v record; _t record; _rate public.courier_vehicle_rates%rowtype;
        _km numeric; _base numeric; _sub numeric; _gst_pct numeric; _gst numeric; _total numeric; _key text; _city text;
begin
  select id, city, latitude, longitude into _m from public.merchants where id = _merchant_id;
  if _m.id is null or _m.latitude is null or _drop_lat is null then
    return jsonb_build_object('ok', false, 'code', 'delivery_unavailable'); end if;
  -- City from the shop's GPS pin (active courier zone), not from typed text.
  select z.city into _city from public.zones z
    join public.courier_zones cz on cz.zone_id = z.id and cz.is_active
   where z.status = 'active' and z.boundary is not null
     and public.point_in_polygon(_m.latitude, _m.longitude, z.boundary)
     and exists (select 1 from public.courier_vehicle_rates r
                  where lower(trim(coalesce(r.city,''))) = lower(trim(coalesce(z.city,'')))
                    and not r.is_placeholder and r.customer_segment = 'regular')
   limit 1;
  _key := lower(trim(coalesce(_city, split_part(coalesce(_m.city,''), ',', 1))));
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
  return jsonb_build_object('ok', true, 'city', coalesce(_city, _m.city), 'vehicle_type_id', _v.id, 'courier_type_id', _t.id,
    'distance_km', _km, 'distance_source', 'haversine', 'base_amount', _base, 'extra_fee', _t.extra_fee,
    'platform_fee', _rate.platform_fee, 'gst_percent', _gst_pct, 'gst_amount', _gst,
    'commission_pct', _rate.commission_pct, 'delivery_fee', _total);
end $function$;
REVOKE ALL ON FUNCTION public.store_courier_fare(uuid,numeric,numeric) FROM public, anon, authenticated;

UPDATE public.merchants SET city = 'Latur', zone_id = 'a112a3ec-60ee-4d7c-ab40-ecb3e52b8157'
 WHERE id = 'd6f2d501-bbeb-4b2d-ab8d-99f307f60f46';