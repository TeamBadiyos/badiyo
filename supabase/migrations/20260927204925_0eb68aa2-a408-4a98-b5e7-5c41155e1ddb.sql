DO $m$ declare d text; o1 text; o2 text; begin
  select pg_get_functiondef('public.business_trip_remove_orders_internal(uuid,uuid[],text,text,text,uuid)'::regprocedure) into d;
  o1 := $x$  if exists (select 1 from public.business_trip_packets p join public.business_orders bo on bo.drop_stop_id=p.drop_stop_id
              where bo.id=any(_order_ids) and p.courier_order_id=_cid and p.scanned_pickup_at is not null
                and (p.code = bo.seal_code or bo.seal_code is null)) then
    return jsonb_build_object('ok',false,'reason','packet_scanned'); end if;$x$;
  o2 := $x$  insert into public.business_trip_removed_packets(removal_id,batch_id,courier_order_id,business_order_id,merchant_id,receiver_id,drop_label,code,reason_code,notes,removed_by,removed_by_id)
  select _rid,_b.id,_cid,bo.id,bo.merchant_id,bo.receiver_id,p.drop_label,p.code,_reason_code,_notes,_by,_by_id
    from public.business_orders bo join public.business_trip_packets p on p.drop_stop_id=bo.drop_stop_id
   where bo.id=any(_order_ids) and (p.code=bo.seal_code or (bo.seal_code is null and not exists
        (select 1 from public.business_orders o2 where o2.drop_stop_id=bo.drop_stop_id and o2.seal_code=p.code)));$x$;
  if position(o1 in d)=0 or position(o2 in d)=0 then raise exception 'patch anchors missing'; end if;
  d := replace(d, o1, $x$  -- choose packets: sealed -> its own code; unsealed -> N unscanned-first packets of that drop (N = removed unsealed packet_count)
  create temp table if not exists _rm_pick(order_id uuid, packet_id uuid, code text, scanned boolean, drop_label text, receiver_id uuid, merchant_id uuid) on commit drop;
  truncate _rm_pick;
  insert into _rm_pick
  select bo.id,p.id,p.code,p.scanned_pickup_at is not null,p.drop_label,bo.receiver_id,bo.merchant_id
    from public.business_orders bo join public.business_trip_packets p on p.code=bo.seal_code and p.courier_order_id=_cid
   where bo.id=any(_order_ids) and bo.seal_code is not null;
  insert into _rm_pick
  select u.oid,u.pid,u.code,u.scanned,u.drop_label,u.receiver_id,u.merchant_id from (
    select x.oid, x.receiver_id, x.merchant_id, p.id pid, p.code, p.scanned_pickup_at is not null scanned, p.drop_label,
           row_number() over (partition by p.drop_stop_id order by (p.scanned_pickup_at is null) desc, p.packet_no desc) rn,
           x.need
      from (select bo.drop_stop_id, min(bo.id::text)::uuid oid, min(bo.receiver_id::text)::uuid receiver_id, min(bo.merchant_id::text)::uuid merchant_id,
                   sum(bo.packet_count) need
              from public.business_orders bo where bo.id=any(_order_ids) and bo.seal_code is null group by bo.drop_stop_id) x
      join public.business_trip_packets p on p.drop_stop_id=x.drop_stop_id and p.courier_order_id=_cid
       and not exists (select 1 from public.business_orders o2 where o2.drop_stop_id=p.drop_stop_id and o2.seal_code=p.code)) u
   where u.rn <= u.need;
  if exists (select 1 from _rm_pick where scanned) then
    return jsonb_build_object('ok',false,'reason','packet_scanned'); end if;$x$);
  d := replace(d, o2, $x$  insert into public.business_trip_removed_packets(removal_id,batch_id,courier_order_id,business_order_id,merchant_id,receiver_id,drop_label,code,reason_code,notes,removed_by,removed_by_id)
  select _rid,_b.id,_cid,order_id,merchant_id,receiver_id,drop_label,code,_reason_code,_notes,_by,_by_id from _rm_pick;$x$);
  execute d; end $m$;