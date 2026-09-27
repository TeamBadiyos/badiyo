UPDATE public.bulk_dispatch_plans SET cost_per_extra_trip = trip_fixed_cost
 WHERE trip_fixed_cost IS NOT NULL AND cost_per_extra_trip IS NULL;

CREATE OR REPLACE FUNCTION public.business_claim_planning_runs(_limit integer DEFAULT 3)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _out jsonb := '[]'::jsonb; _r record; _plan public.bulk_dispatch_plans%rowtype; _price public.bulk_pricing_plans%rowtype;
begin
  for _r in
    update public.business_dispatch_runs set claimed_at=now()
     where id in (select id from public.business_dispatch_runs
                   where status='planning' and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                   order by created_at limit greatest(1, coalesce(_limit,3)) for update skip locked)
    returning *
  loop
    _plan := null; _price := null;
    select p.* into _plan from public.business_profiles bp join public.bulk_dispatch_plans p on p.id=bp.dispatch_plan_id
     where bp.merchant_id=_r.merchant_id;
    select pr.* into _price from public.business_profiles bp join public.bulk_pricing_plans pr on pr.id=bp.pricing_plan_id
     where bp.merchant_id=_r.merchant_id;
    _out := _out || jsonb_build_array(jsonb_build_object(
      'run_id', _r.id,
      'trigger', _r.trigger,
      'min_trip_drops', _r.min_trip_drops,
      'max_drops', greatest(1, coalesce(_plan.max_drops_per_batch, 10)),
      'service_minutes', coalesce(_plan.service_minutes_per_drop, 3),
      'trip_fixed_cost', coalesce(_plan.cost_per_extra_trip, _price.base_fare, 0),
      'per_km', coalesce(_price.per_km, 0),
      'pickup', (select jsonb_build_object('lat', pp.lat, 'lng', pp.lng) from public.business_pickup_points pp where pp.id=_r.pickup_point_id),
      'drops', coalesce((select jsonb_agg(jsonb_build_object('receiver_id', r.id, 'lat', r.lat, 'lng', r.lng))
                 from (select distinct o.receiver_id from public.business_orders o
                        where o.dispatch_run_id=_r.id and o.status='batched' and o.batch_id is null) d
                 join public.business_receivers r on r.id=d.receiver_id), '[]'::jsonb)));
  end loop;
  return _out;
end $function$;

DROP FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer, numeric, numeric);
CREATE FUNCTION public.staff_upsert_dispatch_plan(_id uuid, _name text, _manual_enabled boolean, _qty_enabled boolean, _qty_threshold integer, _slots_enabled boolean, _slot_times time without time zone[], _max_drops_per_batch integer, _is_active boolean DEFAULT true, _time_per_drop_min integer DEFAULT 3, _cost_per_extra_trip numeric DEFAULT NULL::numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _old jsonb; _new public.bulk_dispatch_plans;
begin
  perform public.business_require_super_admin();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if _id is null then
    insert into public.bulk_dispatch_plans(name,manual_enabled,qty_enabled,qty_threshold,slots_enabled,slot_times,max_drops_per_batch,is_active,time_per_drop_min,cost_per_extra_trip)
    values (btrim(_name),coalesce(_manual_enabled,false),coalesce(_qty_enabled,false),_qty_threshold,coalesce(_slots_enabled,false),coalesce(_slot_times,'{}'),_max_drops_per_batch,coalesce(_is_active,true),coalesce(_time_per_drop_min,3),_cost_per_extra_trip)
    returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_dispatch_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.dispatch_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_dispatch_plans set name=btrim(_name),manual_enabled=coalesce(_manual_enabled,false),qty_enabled=coalesce(_qty_enabled,false),
      qty_threshold=_qty_threshold,slots_enabled=coalesce(_slots_enabled,false),slot_times=coalesce(_slot_times,'{}'),
      max_drops_per_batch=_max_drops_per_batch,is_active=coalesce(_is_active,true),time_per_drop_min=coalesce(_time_per_drop_min,3),cost_per_extra_trip=_cost_per_extra_trip where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_dispatch_plan','bulk_dispatch_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $function$;
REVOKE ALL ON FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer, numeric) TO authenticated, service_role;

ALTER TABLE public.bulk_dispatch_plans DROP COLUMN trip_fixed_cost;