
CREATE TABLE public.business_trip_removed_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  removal_id uuid NOT NULL,
  batch_id uuid REFERENCES public.business_batches(id) ON DELETE SET NULL,
  courier_order_id uuid,
  business_order_id uuid REFERENCES public.business_orders(id) ON DELETE SET NULL,
  merchant_id uuid NOT NULL,
  receiver_id uuid,
  drop_label text,
  code text,
  reason_code text NOT NULL,
  notes text,
  removed_by text NOT NULL CHECK (removed_by IN ('rider','business')),
  removed_by_id uuid,
  removed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_trip_removed_packets_m_idx ON public.business_trip_removed_packets(merchant_id, removed_at);
CREATE INDEX business_trip_removed_packets_o_idx ON public.business_trip_removed_packets(courier_order_id);
GRANT SELECT ON public.business_trip_removed_packets TO authenticated;
GRANT ALL ON public.business_trip_removed_packets TO service_role;
ALTER TABLE public.business_trip_removed_packets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner and ops read removed packets" ON public.business_trip_removed_packets
FOR SELECT TO authenticated USING (
  public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','ops'])
  OR merchant_id = public.current_merchant_id()
);

-- Shared internal effect
CREATE OR REPLACE FUNCTION public.business_trip_remove_orders_internal(
  _cid uuid, _order_ids uuid[], _reason_code text, _notes text, _by text, _by_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _o public.courier_orders%rowtype; _b public.business_batches%rowtype; _pl public.bulk_pricing_plans%rowtype;
  _rid uuid := gen_random_uuid(); _codes text[]; _n int; _left int; _res jsonb; _stop record;
  _lat numeric; _lng numeric; _km numeric := 0; _dist numeric; _drops int; _packets int; _billable int;
  _fare numeric; _sf numeric; _gstp numeric; _gst numeric; _total numeric; _refund numeric; _fb jsonb; _old jsonb;
begin
  select * into _o from public.courier_orders where id=_cid for update;
  if _o.id is null or _o.source is distinct from 'business' then return jsonb_build_object('ok',false,'reason','not_business_trip'); end if;
  if _o.status not in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP')
     or exists (select 1 from public.courier_order_stops s where s.order_id=_cid and s.stop_type='pickup' and s.completed_at is not null) then
    return jsonb_build_object('ok',false,'reason','pickup_done'); end if;
  select * into _b from public.business_batches where courier_order_id=_cid for update;
  if _b.id is null or _b.status <> 'dispatched' then return jsonb_build_object('ok',false,'reason','not_in_trip'); end if;
  if coalesce(array_length(_order_ids,1),0)=0 then return jsonb_build_object('ok',false,'reason','nothing_selected'); end if;
  if exists (select 1 from unnest(_order_ids) x(id) where not exists
       (select 1 from public.business_orders bo where bo.id=x.id and bo.courier_order_id=_cid and bo.status='batched')) then
    return jsonb_build_object('ok',false,'reason','not_in_trip'); end if;
  if exists (select 1 from public.business_trip_packets p join public.business_orders bo on bo.drop_stop_id=p.drop_stop_id
              where bo.id=any(_order_ids) and p.courier_order_id=_cid and p.scanned_pickup_at is not null
                and (p.code = bo.seal_code or bo.seal_code is null)) then
    return jsonb_build_object('ok',false,'reason','packet_scanned'); end if;

  _old := to_jsonb(_o);
  -- history rows (one per packet)
  insert into public.business_trip_removed_packets(removal_id,batch_id,courier_order_id,business_order_id,merchant_id,receiver_id,drop_label,code,reason_code,notes,removed_by,removed_by_id)
  select _rid,_b.id,_cid,bo.id,bo.merchant_id,bo.receiver_id,p.drop_label,p.code,_reason_code,_notes,_by,_by_id
    from public.business_orders bo join public.business_trip_packets p on p.drop_stop_id=bo.drop_stop_id
   where bo.id=any(_order_ids) and (p.code=bo.seal_code or (bo.seal_code is null and not exists
        (select 1 from public.business_orders o2 where o2.drop_stop_id=bo.drop_stop_id and o2.seal_code=p.code)));
  select array_agg(code) into _codes from public.business_trip_removed_packets where removal_id=_rid;

  -- all removed -> existing trip cancel path
  if not exists (select 1 from public.business_orders where courier_order_id=_cid and status='batched' and id <> all(_order_ids)) then
    update public.business_trip_removed_packets set reason_code=_reason_code where removal_id=_rid;
    _res := public.business_reject_trip_internal(_cid, 'ALL_PACKETS_REMOVED', 'business', true);
    if coalesce((_res->>'ok')::boolean,false) is not true then raise exception 'Trip cannot be cancelled (%)', _res->>'reason'; end if;
    update public.business_batches set status='rejected', fail_reason='CANCELLED: all packets removed' where id=_b.id;
    delete from public.business_trip_packets where courier_order_id=_cid;
    insert into public.courier_order_events(order_id,from_status,to_status,actor_type,actor_id,meta)
    values (_cid,_o.status,'CANCELLED',_by,_by_id,jsonb_build_object('event','packets_removed','all',true,'codes',to_jsonb(_codes),'reason',_reason_code,'notes',_notes));
    perform public.business_audit('trip_packets_removed','business_batches',_b.id,_old,
      jsonb_build_object('all',true,'codes',to_jsonb(_codes),'reason',_reason_code,'result',_res), _by);
    return jsonb_build_object('ok',true,'trip_cancelled',true,'codes',to_jsonb(_codes),'result',_res);
  end if;

  -- delete packets, detach orders
  delete from public.business_trip_packets p where p.courier_order_id=_cid and p.code in (select unnest(_codes));
  update public.business_orders set status='pending', batch_id=null, batched_at=null, courier_order_id=null,
         parcel_id=null, drop_stop_id=null, dispatch_run_id=null
   where id=any(_order_ids);
  -- empty drops -> cancel parcel + stop
  for _stop in select s.id from public.courier_order_stops s where s.order_id=_cid and s.stop_type='drop' and s.status='pending'
                 and not exists (select 1 from public.business_orders bo where bo.drop_stop_id=s.id) loop
    update public.courier_order_parcels set status='cancelled', updated_at=now() where drop_stop_id=_stop.id;
    update public.courier_order_stops set status='cancelled', updated_at=now() where id=_stop.id;
  end loop;

  -- re-price
  select * into _pl from public.bulk_pricing_plans where id=(_o.fare_breakdown->>'plan_id')::uuid;
  select lat,lng into _lat,_lng from public.courier_order_stops where order_id=_cid and stop_type='pickup' order by sequence limit 1;
  for _stop in select lat,lng from public.courier_order_stops where order_id=_cid and stop_type='drop' and status<>'cancelled' order by sequence loop
    _km := _km + public.haversine_km(_lat,_lng,_stop.lat,_stop.lng); _lat := _stop.lat; _lng := _stop.lng;
  end loop;
  _dist := round(least(coalesce(_o.distance_km,_km*1.3), _km*1.3),2);
  select count(*) into _drops from public.courier_order_stops where order_id=_cid and stop_type='drop' and status<>'cancelled';
  select count(*) into _packets from public.business_orders where courier_order_id=_cid and status='batched';
  _billable := case when coalesce(_o.fare_breakdown->>'drop_count_basis','packet')='packet' then greatest(_packets,_drops) else _drops end;
  _fare := round(greatest(coalesce(_pl.min_fare,0), coalesce(_pl.base_fare,0) + greatest(0,_dist-coalesce(_pl.included_km,0))*coalesce(_pl.per_km,0)),2);
  _sf := round(coalesce(_pl.extra_drop_fee,0)*greatest(0,_billable-1),2);
  _gstp := coalesce((_o.fare_breakdown->>'gst_percent')::numeric, public.get_gst_percent());
  _gst := round((_fare+_sf)*_gstp/100,2);
  _total := round(_fare+_sf+_gst,2);
  if _total > coalesce(_o.total_amount,0) then  -- never charge more than before
    _total := _o.total_amount; _fare := _o.base_amount; _sf := coalesce(_o.stops_fee,0); _gst := _o.gst_amount; _dist := _o.distance_km;
  end if;
  _refund := round(greatest(0, coalesce(_o.total_amount,0) - _total),2);
  _fb := coalesce(_o.fare_breakdown,'{}'::jsonb) || jsonb_build_object('distance_km',_dist,'drops',_drops,'stops',_drops,
    'packet_count',_packets,'billable_drops',_billable,'base_amount',_fare,'stops_fee',_sf,'gst_amount',_gst,'total_amount',_total,
    'packets_removed_refund', coalesce((_o.fare_breakdown->>'packets_removed_refund')::numeric,0)+_refund);
  update public.courier_orders set base_amount=_fare, stops_fee=_sf, gst_amount=_gst, total_amount=_total,
         distance_km=_dist, drop_count=_drops, fare_breakdown=_fb where id=_cid;
  update public.business_batches set total_amount=_total, fare_breakdown=_fb, distance_km=_dist, drops_count=_drops where id=_b.id;
  if _refund > 0 then
    perform public.business_wallet_post(_b.merchant_id,'credit',_refund,
      'Packets removed from trip T'||coalesce(_b.trip_no::text,'?')||' #'||left(_rid::text,8), false, null);
  end if;
  _n := coalesce(array_length(_codes,1),0);
  insert into public.courier_order_events(order_id,from_status,to_status,actor_type,actor_id,meta)
  values (_cid,_o.status,_o.status,_by,_by_id,jsonb_build_object('event','packets_removed','codes',to_jsonb(_codes),
          'reason',_reason_code,'notes',_notes,'refund',_refund,'new_total',_total));
  perform public.business_audit('trip_packets_removed','business_batches',_b.id,_old,
    jsonb_build_object('codes',to_jsonb(_codes),'reason',_reason_code,'notes',_notes,'refund',_refund,'new_total',_total,'removal_id',_rid), _by);
  return jsonb_build_object('ok',true,'trip_cancelled',false,'removal_id',_rid,'codes',to_jsonb(_codes),
    'packets_removed',_n,'refund',_refund,'new_total',_total,'drops_left',_drops);
end $$;
REVOKE ALL ON FUNCTION public.business_trip_remove_orders_internal(uuid,uuid[],text,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- Rider
CREATE OR REPLACE FUNCTION public.courier_rider_leave_packets(_courier_order_id uuid, _packet_ids uuid[], _reason_code text, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _eid uuid := public.get_expert_id_for_auth(auth.uid()); _o public.courier_orders%rowtype; _ids uuid[]; _res jsonb; _b public.business_batches%rowtype;
begin
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _eid is null or _o.id is null or _o.assigned_expert_id is distinct from _eid or _o.source is distinct from 'business' then
    raise exception 'Forbidden' using errcode='42501'; end if;
  if _reason_code not in ('NOT_READY','BUSINESS_HOLD','DAMAGED','OTHER') then raise exception 'Invalid reason'; end if;
  if _reason_code='OTHER' and coalesce(btrim(_notes),'')='' then raise exception 'Notes are required for OTHER'; end if;
  if coalesce(array_length(_packet_ids,1),0)=0 or exists (select 1 from unnest(_packet_ids) x(id)
       where not exists (select 1 from public.business_trip_packets p where p.id=x.id and p.courier_order_id=_o.id)) then
    return jsonb_build_object('ok',false,'reason','not_in_trip'); end if;
  if exists (select 1 from public.business_trip_packets where id=any(_packet_ids) and scanned_pickup_at is not null) then
    return jsonb_build_object('ok',false,'reason','packet_scanned'); end if;
  -- sealed packet -> its order; unsealed packets -> every unsealed order at that drop (all its packets must be selected)
  select array_agg(distinct bo.id) into _ids from public.business_trip_packets p join public.business_orders bo on bo.drop_stop_id=p.drop_stop_id
   where p.id=any(_packet_ids) and (bo.seal_code=p.code or (bo.seal_code is null and not exists
        (select 1 from public.business_orders o2 where o2.drop_stop_id=p.drop_stop_id and o2.seal_code=p.code)));
  if exists (select 1 from public.business_trip_packets p join public.business_orders bo on bo.drop_stop_id=p.drop_stop_id
              where bo.id=any(_ids) and bo.seal_code is null and p.id <> all(_packet_ids)
                and not exists (select 1 from public.business_orders o2 where o2.drop_stop_id=p.drop_stop_id and o2.seal_code=p.code)) then
    return jsonb_build_object('ok',false,'reason','select_all_unsealed_packets_of_drop'); end if;
  _res := public.business_trip_remove_orders_internal(_o.id,_ids,_reason_code,_notes,'rider',_eid);
  if coalesce((_res->>'ok')::boolean,false) then
    select * into _b from public.business_batches where courier_order_id=_o.id limit 1;
    perform public.business_notify(_o.business_merchant_id,
      'Trip T'||coalesce(_b.trip_no::text,'')||': '||jsonb_array_length(_res->'codes')||' packets left behind',
      'Rider did not get these packets; they will go in the next run: '||coalesce((select string_agg(x,', ') from jsonb_array_elements_text(_res->'codes') x),''),
      jsonb_build_object('courier_order_id',_o.id,'batch_id',_b.id,'codes',_res->'codes','reason',_reason_code));
  end if;
  return _res;
end $$;
REVOKE ALL ON FUNCTION public.courier_rider_leave_packets(uuid,uuid[],text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_rider_leave_packets(uuid,uuid[],text,text) TO authenticated;

-- Business
CREATE OR REPLACE FUNCTION public.business_remove_packets_from_trip(_batch_id uuid, _order_ids uuid[], _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare _mid uuid := public.business_require_delivery(); _b public.business_batches%rowtype; _res jsonb; _eid uuid;
begin
  if coalesce(btrim(_reason),'')='' then raise exception 'A reason is required'; end if;
  select * into _b from public.business_batches where id=_batch_id;
  if _b.id is null or _b.merchant_id is distinct from _mid then raise exception 'Forbidden' using errcode='42501'; end if;
  if _b.courier_order_id is null then return jsonb_build_object('ok',false,'reason','not_in_trip'); end if;
  _res := public.business_trip_remove_orders_internal(_b.courier_order_id,_order_ids,'BUSINESS_REMOVED',btrim(_reason),'business',auth.uid());
  if coalesce((_res->>'ok')::boolean,false) then
    select assigned_expert_id into _eid from public.courier_orders where id=_b.courier_order_id;
    if _eid is not null then
      perform public.notify_expert_alert(_eid,'trip_updated','Trip updated',
        jsonb_array_length(_res->'codes')||' packets were removed from the trip by the business.',
        jsonb_build_object('order_id',_b.courier_order_id,'codes',_res->'codes'));
    end if;
  end if;
  return _res;
end $$;
REVOKE ALL ON FUNCTION public.business_remove_packets_from_trip(uuid,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_remove_packets_from_trip(uuid,uuid[],text) TO authenticated;

-- Stats
CREATE OR REPLACE FUNCTION public.business_left_behind_stats(_merchant_id uuid, _date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not (public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','ops'])
          or _merchant_id = public.current_merchant_id()) then raise exception 'Forbidden' using errcode='42501'; end if;
  return jsonb_build_object('merchant_id',_merchant_id,'date',_date,
    'total',(select count(*) from public.business_trip_removed_packets where merchant_id=_merchant_id and (removed_at at time zone 'Asia/Kolkata')::date=_date),
    'by_reason',coalesce((select jsonb_object_agg(reason_code,c) from (select reason_code,count(*) c from public.business_trip_removed_packets
        where merchant_id=_merchant_id and (removed_at at time zone 'Asia/Kolkata')::date=_date group by 1) t),'{}'::jsonb),
    'by_actor',coalesce((select jsonb_object_agg(removed_by,c) from (select removed_by,count(*) c from public.business_trip_removed_packets
        where merchant_id=_merchant_id and (removed_at at time zone 'Asia/Kolkata')::date=_date group by 1) t),'{}'::jsonb));
end $$;
REVOKE ALL ON FUNCTION public.business_left_behind_stats(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_left_behind_stats(uuid,date) TO authenticated;

-- Reads: add removed packets
CREATE OR REPLACE FUNCTION public.courier_trip_packets(_courier_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _eid uuid; _o public.courier_orders%rowtype;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _eid is null or _o.id is null or _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  return jsonb_build_object('order_id', _o.id,
    'trip_no', (select trip_no from public.business_batches where courier_order_id=_o.id limit 1),
    'packets', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'drop_stop_id',p.drop_stop_id,
        'drop_label',p.drop_label,'packet_no',p.packet_no,'packet_total',p.packet_total,
        'scanned_pickup_at',p.scanned_pickup_at,'scanned_drop_at',p.scanned_drop_at,
        'pickup_entry_method',p.pickup_entry_method,'drop_entry_method',p.drop_entry_method,
        'is_seal', p.code ~ '^[0-9]{7}$',
        'printed_code', case when p.code ~ '^[0-9]{7}$' then left(p.code,6)||'-'||right(p.code,1) else p.code end)
        order by s.sequence, p.packet_no)
      from public.business_trip_packets p join public.courier_order_stops s on s.id=p.drop_stop_id
      where p.courier_order_id=_o.id),'[]'::jsonb),
    'removed_packets', coalesce((select jsonb_agg(jsonb_build_object('code',rp.code,'drop_label',rp.drop_label,
        'receiver_name',(select r.name from public.business_receivers r where r.id=rp.receiver_id),
        'reason',rp.reason_code,'notes',rp.notes,'removed_by',rp.removed_by,'removed_at',rp.removed_at) order by rp.removed_at)
      from public.business_trip_removed_packets rp where rp.courier_order_id=_o.id),'[]'::jsonb));
end $function$;
