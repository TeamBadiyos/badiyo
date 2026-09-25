create or replace function public.courier_create_business_order(
  _batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[],
  _fare jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _b public.business_batches%rowtype; _p public.business_profiles%rowtype; _m public.merchants%rowtype;
        _pp public.business_pickup_points%rowtype; _cid uuid; _seq int := 1; _sid uuid; _pick_sid uuid;
        _r public.business_receivers%rowtype; _first_drop public.business_receivers%rowtype;
        _rid uuid; _parcel_id uuid;
begin
  select * into _b from public.business_batches where id=_batch_id;
  select * into _p from public.business_profiles where merchant_id=_b.merchant_id;
  select * into _m from public.merchants where id=_b.merchant_id;
  select * into _pp from public.business_pickup_points where id=_b.pickup_point_id;
  select * into _first_drop from public.business_receivers where id=_receiver_order[1];

  perform set_config('app.courier_skip_default_stops','on',true);

  insert into public.courier_orders (
    customer_id, city, vehicle_type_id, courier_type_id,
    pickup_lat, pickup_lng, pickup_address, pickup_contact_name, pickup_contact_phone,
    drop_lat, drop_lng, drop_address, drop_contact_name, drop_contact_phone,
    package_description, weight_kg, prohibited_items_confirmed,
    distance_km, distance_source, fare_breakdown, quote_expires_at,
    base_amount, extra_fee, platform_fee, discount_amount,
    gst_percent, gst_amount, total_amount, commission_pct, status, payment_status,
    pickup_count, drop_count, stops_fee, source, business_merchant_id
  ) values (
    _m.auth_user_id, coalesce(_p.city, _m.city, 'NA'), _p.vehicle_type_id, _p.courier_type_id,
    _pp.lat, _pp.lng, _pp.address, coalesce(_pp.contact_name, _m.store_name, 'Pickup'),
    coalesce(_pp.contact_phone, _m.phone),
    _first_drop.lat, _first_drop.lng, _first_drop.address,
    coalesce(_first_drop.contact_name, _first_drop.name), _first_drop.contact_phone,
    'Business batch', 0, true,
    _distance_km, coalesce(_distance_source,'routes'), _fare, now() + interval '1 day',
    (_fare->>'base_amount')::numeric, 0, 0, 0,
    (_fare->>'gst_percent')::numeric, (_fare->>'gst_amount')::numeric, (_fare->>'total_amount')::numeric,
    (_fare->>'commission_pct')::numeric, 'REQUESTED', 'paid',
    1, coalesce(array_length(_receiver_order,1),1), (_fare->>'stops_fee')::numeric, 'business', _b.merchant_id
  ) returning id into _cid;

  perform set_config('app.courier_skip_default_stops','off',true);

  insert into public.courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone)
  values (_cid, 'pickup', 1, _pp.lat, _pp.lng, _pp.address,
          coalesce(_pp.contact_name, _m.store_name, 'Pickup'), coalesce(_pp.contact_phone, _m.phone))
  returning id into _pick_sid;

  foreach _rid in array _receiver_order loop
    select * into _r from public.business_receivers where id=_rid;
    _seq := _seq + 1;
    insert into public.courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone)
    values (_cid, 'drop', _seq, _r.lat, _r.lng, _r.address, coalesce(_r.contact_name, _r.name), _r.contact_phone)
    returning id into _sid;

    insert into public.courier_order_parcels(order_id, pickup_stop_id, drop_stop_id, description)
    values (_cid, _pick_sid, _sid,
      coalesce((select string_agg(coalesce(o.reference_no, o.description, 'Parcel'), ', ')
                  from public.business_orders o where o.batch_id=_batch_id and o.receiver_id=_rid), 'Parcel'))
    returning id into _parcel_id;

    update public.business_orders
       set status='in_transit', courier_order_id=_cid, drop_stop_id=_sid, parcel_id=_parcel_id
     where batch_id=_batch_id and receiver_id=_rid;
  end loop;

  return _cid;
end $$;

revoke all on function public.courier_create_business_order(uuid, numeric, text, uuid[], jsonb) from public, anon, authenticated;