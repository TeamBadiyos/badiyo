-- 1. Tighten order linking in business_finalize_batch (from LIVE definition)
CREATE OR REPLACE FUNCTION public.business_finalize_batch(_batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _b public.business_batches%rowtype; _p public.business_profiles%rowtype; _pl public.bulk_pricing_plans%rowtype;
        _m public.merchants%rowtype; _drops int; _fare numeric; _stops_fee numeric; _gstp numeric; _gst numeric;
        _total numeric; _fb jsonb; _cid uuid;
begin
  select * into _b from public.business_batches where id=_batch_id for update;
  if _b.id is null then return jsonb_build_object('ok', false, 'reason','NOT_FOUND'); end if;
  if _b.status not in ('planning','awaiting_balance') then
    return jsonb_build_object('ok', true, 'already', _b.status, 'courier_order_id', _b.courier_order_id);
  end if;
  select * into _p from public.business_profiles where merchant_id=_b.merchant_id;
  select * into _pl from public.bulk_pricing_plans where id=_p.pricing_plan_id and is_active;
  select * into _m from public.merchants where id=_b.merchant_id;

  if _pl.id is null then
    update public.business_batches set status='failed', fail_reason='NO_PLAN' where id=_batch_id;
    update public.business_orders set status='pending', batch_id=null, batched_at=null where batch_id=_batch_id;
    return jsonb_build_object('ok', false, 'reason','NO_PLAN');
  end if;
  if _m.auth_user_id is null then
    update public.business_batches set status='failed', fail_reason='OWNER_NOT_SIGNED_IN' where id=_batch_id;
    update public.business_orders set status='pending', batch_id=null, batched_at=null where batch_id=_batch_id;
    return jsonb_build_object('ok', false, 'reason','OWNER_NOT_SIGNED_IN');
  end if;
  _drops := coalesce(array_length(_receiver_order,1),0);
  if _drops = 0 then
    update public.business_batches set status='failed', fail_reason='NO_DROPS' where id=_batch_id;
    update public.business_orders set status='pending', batch_id=null, batched_at=null where batch_id=_batch_id;
    return jsonb_build_object('ok', false, 'reason','NO_DROPS');
  end if;

  -- attach only orders from the SAME dispatch run, business and pickup point,
  -- that are already claimed by the run ('batched') and not linked to another trip.
  -- Orders created after the run started stay 'pending' for the next run.
  if _b.dispatch_run_id is not null then
    update public.business_orders
       set batch_id=_batch_id
     where merchant_id=_b.merchant_id
       and pickup_point_id=_b.pickup_point_id
       and dispatch_run_id=_b.dispatch_run_id
       and status='batched'
       and batch_id is null
       and receiver_id = any(_receiver_order);
  end if;

  _fare := greatest(coalesce(_pl.min_fare,0),
             coalesce(_pl.base_fare,0) + greatest(0, coalesce(_distance_km,0) - coalesce(_pl.included_km,0)) * coalesce(_pl.per_km,0));
  _stops_fee := coalesce(_pl.extra_drop_fee,0) * greatest(0, _drops - 1);
  _fare := round(_fare, 2);
  _stops_fee := round(_stops_fee, 2);
  _gstp := public.get_gst_percent();
  _gst := round((_fare + _stops_fee) * _gstp / 100.0, 2);
  _total := round(_fare + _stops_fee + _gst, 2);
  _fb := jsonb_build_object(
    'source','business_plan','plan_id',_pl.id,'plan_name',_pl.name,
    'distance_km',_distance_km,'drops',_drops,
    'base_amount',_fare,'stops_fee',_stops_fee,
    'gst_percent',_gstp,'gst_amount',_gst,'total_amount',_total,
    'commission_pct', coalesce(_pl.commission_pct,0),
    'return_per_km', coalesce(_pl.return_per_km,0));

  if coalesce(_m.delivery_wallet_balance,0) < _total then
    update public.business_batches
       set status='awaiting_balance', fail_reason='LOW_BALANCE', total_amount=_total,
           fare_breakdown=_fb, distance_km=_distance_km, distance_source=_distance_source, claimed_at=null
     where id=_batch_id;
    perform public.business_notify(_b.merchant_id, 'Low wallet balance',
      'Top up to dispatch ' || (select count(*) from public.business_orders where batch_id=_batch_id) || ' orders',
      jsonb_build_object('batch_id',_batch_id,'needed',_total));
    return jsonb_build_object('ok', false, 'reason','LOW_BALANCE','total',_total);
  end if;

  _cid := public.courier_create_business_order(_batch_id, _distance_km, _distance_source, _receiver_order, _fb);
  perform public.business_wallet_post(_b.merchant_id, 'debit', _total, 'batch:' || _cid::text, false, null);
  update public.business_batches
     set status='dispatched', fail_reason=null, total_amount=_total, fare_breakdown=_fb,
         distance_km=_distance_km, distance_source=_distance_source, courier_order_id=_cid, claimed_at=null
   where id=_batch_id;
  perform public.courier_start_dispatch(_cid);
  return jsonb_build_object('ok', true, 'courier_order_id', _cid, 'total', _total);
exception when others then
  update public.business_batches set status='failed', fail_reason=left(sqlerrm,200), claimed_at=null where id=_batch_id;
  update public.business_orders set status='pending', batch_id=null, batched_at=null, courier_order_id=null, parcel_id=null, drop_stop_id=null
   where batch_id=_batch_id and status='batched';
  return jsonb_build_object('ok', false, 'reason', left(sqlerrm,200));
end $function$;

-- 2. Tighten courier_create_business_order order update (from LIVE definition)
CREATE OR REPLACE FUNCTION public.courier_create_business_order(_batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[], _fare jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _b public.business_batches%rowtype; _p public.business_profiles%rowtype; _m public.merchants%rowtype;
        _pp public.business_pickup_points%rowtype; _cid uuid; _seq int := 1; _sid uuid; _pick_sid uuid;
        _r public.business_receivers%rowtype; _first_drop public.business_receivers%rowtype;
        _rid uuid; _parcel_id uuid; _skill uuid;
begin
  select * into _b from public.business_batches where id=_batch_id;
  select * into _p from public.business_profiles where merchant_id=_b.merchant_id;
  select * into _m from public.merchants where id=_b.merchant_id;
  select * into _pp from public.business_pickup_points where id=_b.pickup_point_id;
  select * into _first_drop from public.business_receivers where id=_receiver_order[1];
  select id into _skill from public.service_categories where slug='bulk-delivery' and is_active order by rank limit 1;

  perform set_config('app.courier_skip_default_stops','on',true);
  insert into public.courier_orders (
    customer_id, city, vehicle_type_id, courier_type_id,
    pickup_lat, pickup_lng, pickup_address, pickup_contact_name, pickup_contact_phone,
    drop_lat, drop_lng, drop_address, drop_contact_name, drop_contact_phone,
    package_description, weight_kg, prohibited_items_confirmed,
    distance_km, distance_source, fare_breakdown, quote_expires_at,
    base_amount, extra_fee, platform_fee, discount_amount,
    gst_percent, gst_amount, total_amount, commission_pct, status, payment_status,
    pickup_count, drop_count, stops_fee, source, business_merchant_id, required_skill_id
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
    1, coalesce(array_length(_receiver_order,1),1), (_fare->>'stops_fee')::numeric, 'business', _b.merchant_id, _skill
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
                  from public.business_orders o
                 where o.batch_id=_batch_id and o.receiver_id=_rid
                   and o.merchant_id=_b.merchant_id and o.pickup_point_id=_b.pickup_point_id), 'Parcel'))
    returning id into _parcel_id;
    update public.business_orders
       set courier_order_id=_cid, drop_stop_id=_sid, parcel_id=_parcel_id
     where batch_id=_batch_id and receiver_id=_rid
       and merchant_id=_b.merchant_id and pickup_point_id=_b.pickup_point_id;
  end loop;
  return _cid;
end $function$;

-- 3. Clear stale pre-rebuild planning batches (never charged, so no wallet change)
UPDATE public.business_orders o
   SET status='pending', batch_id=null, batched_at=null, dispatch_run_id=null,
       courier_order_id=null, parcel_id=null, drop_stop_id=null
  FROM public.business_batches b
 WHERE o.batch_id = b.id
   AND b.status = 'planning'
   AND b.dispatch_run_id IS NULL
   AND b.courier_order_id IS NULL;

UPDATE public.business_batches
   SET status='failed', fail_reason='STALE_PRE_RUN', claimed_at=null
 WHERE status='planning'
   AND dispatch_run_id IS NULL
   AND courier_order_id IS NULL;