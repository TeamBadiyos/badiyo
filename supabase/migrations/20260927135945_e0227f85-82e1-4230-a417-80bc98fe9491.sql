ALTER TABLE public.bulk_dispatch_plans ADD COLUMN IF NOT EXISTS trip_fixed_cost numeric;
ALTER TABLE public.bulk_dispatch_plans ADD CONSTRAINT bulk_dispatch_plans_trip_fixed_cost_check CHECK (trip_fixed_cost IS NULL OR trip_fixed_cost >= 0);
ALTER TABLE public.business_dispatch_runs ADD COLUMN IF NOT EXISTS held_drops int NOT NULL DEFAULT 0;
ALTER TABLE public.business_dispatch_runs ADD COLUMN IF NOT EXISTS min_trip_drops int;

CREATE TABLE public.business_qty_check_state (
  merchant_id uuid NOT NULL,
  pickup_point_id uuid NOT NULL,
  last_check_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, pickup_point_id)
);
GRANT ALL ON public.business_qty_check_state TO service_role;
ALTER TABLE public.business_qty_check_state ENABLE ROW LEVEL SECURITY;

-- qty trigger: throttle 5 min per merchant + pickup point
CREATE OR REPLACE FUNCTION public.business_orders_qty_check()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _p public.business_profiles%rowtype; _plan public.bulk_dispatch_plans%rowtype; _thr int; _cnt int; _ok boolean;
begin
  select * into _p from public.business_profiles where merchant_id=NEW.merchant_id;
  if _p.merchant_id is null or _p.dispatch_plan_id is null or _p.pricing_plan_id is null then return NEW; end if;
  select * into _plan from public.bulk_dispatch_plans where id=_p.dispatch_plan_id and is_active;
  if _plan.id is null or not _plan.qty_enabled then return NEW; end if;
  _thr := greatest(1, coalesce(_plan.qty_threshold, 10));
  select count(distinct o.receiver_id) into _cnt from public.business_orders o
   where o.merchant_id=NEW.merchant_id and o.status='pending' and o.pickup_point_id=NEW.pickup_point_id;
  if _cnt >= _thr then
    insert into public.business_qty_check_state as s (merchant_id, pickup_point_id, last_check_at)
    values (NEW.merchant_id, NEW.pickup_point_id, now())
    on conflict (merchant_id, pickup_point_id) do update set last_check_at = now()
      where s.last_check_at < now() - interval '5 minutes'
    returning true into _ok;
    if coalesce(_ok,false) then
      perform public.business_group_and_batch(NEW.merchant_id, 'qty', jsonb_build_object('pickup_point_id', NEW.pickup_point_id));
    end if;
  end if;
  return NEW;
exception when others then
  raise warning 'business_orders_qty_check failed: %', sqlerrm;
  return NEW;
end $function$;

-- group: store min_trip_drops for qty runs
CREATE OR REPLACE FUNCTION public.business_group_and_batch(_merchant_id uuid, _trigger text, _group_filter jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  _p record; _plan public.bulk_dispatch_plans%rowtype; _st jsonb;
  _pp uuid; _run uuid; _drops int; _runs int := 0; _rejected int := 0; _c record; _r record;
  _pp_filter uuid := nullif(_group_filter->>'pickup_point_id','')::uuid;
begin
  select * into _p from public.business_profiles where merchant_id=_merchant_id;
  if _p.merchant_id is null or _p.pricing_plan_id is null or _p.dispatch_plan_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_PLAN', 'runs', 0);
  end if;
  select * into _plan from public.bulk_dispatch_plans where id=_p.dispatch_plan_id and is_active;
  if _plan.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_PLAN', 'runs', 0); end if;

  _st := public.service_effective_state('courier', null, now());
  if not coalesce((_st->>'can_order')::boolean, true) then
    return jsonb_build_object('ok', false, 'reason', 'SERVICE_CLOSED', 'runs', 0);
  end if;

  create temp table if not exists _bg_orders (order_id uuid, receiver_id uuid, pickup_point_id uuid) on commit drop;
  truncate _bg_orders;

  for _pp in
    select distinct pickup_point_id from (
      select o.pickup_point_id from public.business_orders o
       where o.merchant_id=_merchant_id and o.status='pending'
      union
      select b.pickup_point_id from public.business_batches b join public.courier_orders c on c.id=b.courier_order_id
       where b.merchant_id=_merchant_id and c.status in ('REQUESTED','SEARCHING') and c.assigned_expert_id is null
    ) q where _pp_filter is null or pickup_point_id=_pp_filter
  loop
    for _c in
      select c.id from public.business_batches b join public.courier_orders c on c.id=b.courier_order_id
       where b.merchant_id=_merchant_id and b.pickup_point_id=_pp
         and c.source='business' and c.status in ('REQUESTED','SEARCHING') and c.assigned_expert_id is null
         and c.created_at < now()
    loop
      if public.business_reject_trip_internal(_c.id, 'auto_rejected_next_run') then _rejected := _rejected + 1; end if;
    end loop;

    truncate _bg_orders;
    for _r in
      select o.id, o.receiver_id from public.business_orders o
       where o.merchant_id=_merchant_id and o.status='pending' and o.pickup_point_id=_pp
       order by o.created_at for update of o skip locked
    loop
      insert into _bg_orders values (_r.id, _r.receiver_id, _pp);
    end loop;
    select count(distinct receiver_id) into _drops from _bg_orders;
    if coalesce(_drops,0) = 0 then continue; end if;

    insert into public.business_dispatch_runs(merchant_id, pickup_point_id, trigger, status, drops, min_trip_drops)
    values (_merchant_id, _pp, _trigger, 'planning', _drops,
            case when _trigger='qty' then greatest(1, coalesce(_plan.qty_threshold,10)) end)
    returning id into _run;
    update public.business_orders set status='batched', batch_id=null, batched_at=now(), dispatch_run_id=_run
     where id in (select order_id from _bg_orders);
    _runs := _runs + 1;
  end loop;

  if _runs > 0 then perform public.business_batches_wake(); end if;
  return jsonb_build_object('ok', true, 'runs', _runs, 'rejected_trips', _rejected);
end $function$;

-- claim: expose trigger, min_trip_drops, trip_fixed_cost, per_km
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
      'trip_fixed_cost', coalesce(_plan.trip_fixed_cost, _price.base_fare, 0),
      'per_km', coalesce(_price.per_km, 0),
      'pickup', (select jsonb_build_object('lat', pp.lat, 'lng', pp.lng) from public.business_pickup_points pp where pp.id=_r.pickup_point_id),
      'drops', coalesce((select jsonb_agg(jsonb_build_object('receiver_id', r.id, 'lat', r.lat, 'lng', r.lng))
                 from (select distinct o.receiver_id from public.business_orders o
                        where o.dispatch_run_id=_r.id and o.status='batched' and o.batch_id is null) d
                 join public.business_receivers r on r.id=d.receiver_id), '[]'::jsonb)));
  end loop;
  return _out;
end $function$;

-- create trip: hold small trips on qty runs
CREATE OR REPLACE FUNCTION public.business_create_trip(_run_id uuid, _trip_no integer, _receiver_order uuid[], _distance_km numeric, _distance_source text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _run public.business_dispatch_runs%rowtype; _bid uuid; _zone uuid; _label text; _labels jsonb; _res jsonb; _n int;
begin
  select * into _run from public.business_dispatch_runs where id=_run_id for update;
  if _run.id is null or _run.status <> 'planning' then return jsonb_build_object('ok',false,'reason','RUN_NOT_PLANNING'); end if;
  _n := coalesce(array_length(_receiver_order,1),0);
  if _n = 0 then return jsonb_build_object('ok',false,'reason','NO_DROPS'); end if;
  if _run.min_trip_drops is not null and _n < _run.min_trip_drops then
    return jsonb_build_object('ok',false,'held',true,'reason','BELOW_QTY_THRESHOLD','drops',_n,'min',_run.min_trip_drops);
  end if;

  select z into _zone from (
    select nullif(public.courier_check_serviceability(r.lat, r.lng)->>'zone_id','')::uuid z
      from public.business_receivers r where r.id = any(_receiver_order)) q
   where z is not null group by z order by count(*) desc limit 1;
  select name into _label from public.zones where id=_zone;
  select jsonb_agg(jsonb_build_object('receiver_id', rid, 'label', 'C' || i) order by i) into _labels
    from unnest(_receiver_order) with ordinality u(rid, i);

  insert into public.business_batches(merchant_id, pickup_point_id, zone_id, trigger, status, drops_count,
      dispatch_run_id, trip_no, trip_label, drop_labels, receiver_order, distance_km, distance_source)
  values (_run.merchant_id, _run.pickup_point_id, _zone, _run.trigger, 'planning', _n,
      _run_id, _trip_no, coalesce(_label, 'Trip ' || _trip_no), coalesce(_labels,'[]'::jsonb), _receiver_order, _distance_km, _distance_source)
  returning id into _bid;
  update public.business_orders set batch_id=_bid
   where dispatch_run_id=_run_id and status='batched' and batch_id is null and receiver_id = any(_receiver_order);

  _res := public.business_finalize_batch(_bid, _distance_km, _distance_source, _receiver_order);
  return _res || jsonb_build_object('batch_id', _bid);
end $function$;

-- complete run: record + log held drops
CREATE OR REPLACE FUNCTION public.business_complete_run(_run_id uuid, _method text, _total_km numeric, _skipped uuid[], _error text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _released int; _trips int; _held int := 0; _run public.business_dispatch_runs%rowtype;
begin
  select * into _run from public.business_dispatch_runs where id=_run_id;
  if _run.min_trip_drops is not null then
    select count(distinct receiver_id) into _held from public.business_orders
     where dispatch_run_id=_run_id and status='batched' and batch_id is null
       and not (receiver_id = any(coalesce(_skipped,'{}'::uuid[])));
  end if;
  update public.business_orders set status='pending', batched_at=null, dispatch_run_id=null
   where dispatch_run_id=_run_id and status='batched' and batch_id is null;
  get diagnostics _released = row_count;
  select count(*) into _trips from public.business_batches where dispatch_run_id=_run_id;
  update public.business_dispatch_runs
     set status = case when _trips = 0 and _error is not null and coalesce(_held,0) = 0 then 'failed' else 'done' end,
         method=_method, trips=_trips, total_km=round(coalesce(_total_km,0),2), held_drops=coalesce(_held,0),
         skipped=to_jsonb(coalesce(_skipped,'{}'::uuid[])), error=_error, claimed_at=null
   where id=_run_id;
  if coalesce(_held,0) > 0 then
    raise log 'business_dispatch_held run=% merchant=% held_drops=% trips=%', _run_id, _run.merchant_id, _held, _trips;
    perform public.business_audit('business_dispatch_held','business_dispatch_runs',_run_id,null,
      jsonb_build_object('held_drops',_held,'trips',_trips,'min_trip_drops',_run.min_trip_drops),'system');
  end if;
  return jsonb_build_object('ok',true,'trips',_trips,'released_orders',_released,'held_drops',coalesce(_held,0));
end $function$;

-- staff plan upsert: add _trip_fixed_cost
DROP FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer, numeric);
CREATE FUNCTION public.staff_upsert_dispatch_plan(_id uuid, _name text, _manual_enabled boolean, _qty_enabled boolean, _qty_threshold integer, _slots_enabled boolean, _slot_times time without time zone[], _max_drops_per_batch integer, _is_active boolean DEFAULT true, _time_per_drop_min integer DEFAULT 3, _cost_per_extra_trip numeric DEFAULT NULL, _trip_fixed_cost numeric DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _old jsonb; _new public.bulk_dispatch_plans;
begin
  perform public.business_require_super_admin();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if _trip_fixed_cost is not null and _trip_fixed_cost < 0 then raise exception 'Trip fixed cost must be 0 or more'; end if;
  if _id is null then
    insert into public.bulk_dispatch_plans(name,manual_enabled,qty_enabled,qty_threshold,slots_enabled,slot_times,max_drops_per_batch,is_active,time_per_drop_min,cost_per_extra_trip,trip_fixed_cost)
    values (btrim(_name),coalesce(_manual_enabled,false),coalesce(_qty_enabled,false),_qty_threshold,coalesce(_slots_enabled,false),coalesce(_slot_times,'{}'),_max_drops_per_batch,coalesce(_is_active,true),coalesce(_time_per_drop_min,3),_cost_per_extra_trip,_trip_fixed_cost)
    returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_dispatch_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.dispatch_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_dispatch_plans set name=btrim(_name),manual_enabled=coalesce(_manual_enabled,false),qty_enabled=coalesce(_qty_enabled,false),
      qty_threshold=_qty_threshold,slots_enabled=coalesce(_slots_enabled,false),slot_times=coalesce(_slot_times,'{}'),
      max_drops_per_batch=_max_drops_per_batch,is_active=coalesce(_is_active,true),time_per_drop_min=coalesce(_time_per_drop_min,3),
      cost_per_extra_trip=_cost_per_extra_trip, trip_fixed_cost=_trip_fixed_cost where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_dispatch_plan','bulk_dispatch_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $function$;
REVOKE ALL ON FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert_dispatch_plan(uuid, text, boolean, boolean, integer, boolean, time without time zone[], integer, boolean, integer, numeric, numeric) TO authenticated, service_role;