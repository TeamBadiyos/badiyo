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

  -- make sure every waiting order for these receivers is linked to this trip,
  -- so parcel / stop links (and the status sync triggers) reach them
  update public.business_orders
     set batch_id=_batch_id, status='batched', batched_at=coalesce(batched_at, now()),
         dispatch_run_id=coalesce(dispatch_run_id, _b.dispatch_run_id)
   where merchant_id=_b.merchant_id
     and pickup_point_id=_b.pickup_point_id
     and receiver_id = any(_receiver_order)
     and batch_id is null
     and status in ('pending','batched')
     and (_b.dispatch_run_id is null or dispatch_run_id is null or dispatch_run_id=_b.dispatch_run_id);

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