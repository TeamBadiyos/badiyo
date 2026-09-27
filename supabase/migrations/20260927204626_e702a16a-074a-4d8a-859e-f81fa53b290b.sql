DO $m$
declare d text;
begin
  select pg_get_functiondef('public.business_get_trip_otps(uuid)'::regprocedure) into d;
  d := replace(d, $x$'rider_name',_rider_name,'rider_phone',_rider_phone,$x$,
    $x$'rider_name',_rider_name,'rider_phone',_rider_phone,
    'removed_packets', coalesce((select jsonb_agg(jsonb_build_object('code',rp.code,'drop_label',rp.drop_label,
        'receiver_name',(select r.name from public.business_receivers r where r.id=rp.receiver_id),
        'reason',rp.reason_code,'notes',rp.notes,'removed_by',rp.removed_by,'removed_at',rp.removed_at) order by rp.removed_at)
      from public.business_trip_removed_packets rp where rp.courier_order_id=_o.id),'[]'::jsonb),$x$);
  if position('removed_packets' in d) = 0 then raise exception 'patch failed'; end if;
  execute d;
end $m$;