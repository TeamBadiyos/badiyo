
-- 1. Settings
alter table public.bulk_dispatch_plans add column if not exists service_minutes_per_drop int not null default 3;
alter table public.bulk_dispatch_plans drop constraint if exists bulk_dispatch_plans_service_minutes_chk;
alter table public.bulk_dispatch_plans add constraint bulk_dispatch_plans_service_minutes_chk check (service_minutes_per_drop between 1 and 15);

-- 2. Runs
create table public.business_dispatch_runs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  pickup_point_id uuid not null references public.business_pickup_points(id),
  trigger text not null check (trigger in ('manual','qty','slot')),
  status text not null default 'planning' check (status in ('planning','done','failed')),
  method text check (method in ('google_route_opt','fallback')),
  drops int not null default 0,
  trips int not null default 0,
  total_km numeric not null default 0,
  skipped jsonb not null default '[]'::jsonb,
  error text,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.business_dispatch_runs to authenticated;
grant all on public.business_dispatch_runs to service_role;
alter table public.business_dispatch_runs enable row level security;
create policy "dispatch runs readable by owner and ops" on public.business_dispatch_runs
  for select to authenticated
  using (public.courier_is_ops_staff() or (merchant_id = public.current_merchant_id() and public.merchant_caller_has_perm('manage_delivery')));
create trigger business_dispatch_runs_touch before update on public.business_dispatch_runs
  for each row execute function public.business_touch();
create index business_dispatch_runs_status_idx on public.business_dispatch_runs(status, created_at);

alter table public.business_orders add column if not exists dispatch_run_id uuid references public.business_dispatch_runs(id);
create index if not exists business_orders_run_idx on public.business_orders(dispatch_run_id);
alter table public.business_batches add column if not exists dispatch_run_id uuid references public.business_dispatch_runs(id);
alter table public.business_batches add column if not exists trip_no int;
alter table public.business_batches add column if not exists trip_label text;
alter table public.business_batches add column if not exists drop_labels jsonb not null default '[]'::jsonb;
alter table public.business_batches add column if not exists receiver_order uuid[];
alter table public.business_dispatch_state add column if not exists last_notice_date date;
alter table public.business_dispatch_state add column if not exists last_notice_time time;

-- 3. Internal: reject a business trip that still has no rider (same effect as ops force-cancel)
create or replace function public.business_reject_trip_internal(_cid uuid, _reason text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare _o public.courier_orders%rowtype;
begin
  select * into _o from public.courier_orders where id=_cid for update;
  if _o.id is null or _o.source is distinct from 'business' or _o.assigned_expert_id is not null
     or _o.status not in ('REQUESTED','SEARCHING') then return false; end if;
  perform set_config('app.courier_actor_type','staff',true);
  update public.courier_orders
     set status='CANCELLED', cancelled_by='staff', cancelled_at=now(),
         cancel_reason_code=coalesce(_reason,'auto_rejected'), needs_ops_attention=false
   where id=_cid;
  update public.courier_offers set status='cancelled' where order_id=_cid and status='pending';
  -- business_sync_from_order sends orders back to pending and credits the wallet once ('refund:<id>')
  return true;
end $function$;
revoke all on function public.business_reject_trip_internal(uuid,text) from public, anon, authenticated;

-- 4. Dispatch run
create or replace function public.business_group_and_batch(_merchant_id uuid, _trigger text, _group_filter jsonb DEFAULT NULL::jsonb)
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
    -- a. reject earlier trips at this pickup point that still have no rider
    for _c in
      select c.id from public.business_batches b join public.courier_orders c on c.id=b.courier_order_id
       where b.merchant_id=_merchant_id and b.pickup_point_id=_pp
         and c.source='business' and c.status in ('REQUESTED','SEARCHING') and c.assigned_expert_id is null
         and c.created_at < now()
    loop
      if public.business_reject_trip_internal(_c.id, 'auto_rejected_next_run') then _rejected := _rejected + 1; end if;
    end loop;

    -- b. take all pending orders at this pickup point
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

    -- c. create the run and mark the orders
    insert into public.business_dispatch_runs(merchant_id, pickup_point_id, trigger, status, drops)
    values (_merchant_id, _pp, _trigger, 'planning', _drops) returning id into _run;
    update public.business_orders set status='batched', batch_id=null, batched_at=now(), dispatch_run_id=_run
     where id in (select order_id from _bg_orders);
    _runs := _runs + 1;
  end loop;

  if _runs > 0 then perform public.business_batches_wake(); end if;
  return jsonb_build_object('ok', true, 'runs', _runs, 'rejected_trips', _rejected);
end $function$;

-- qty trigger: counts ALL pending drops at the pickup point
CREATE OR REPLACE FUNCTION public.business_orders_qty_check()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _p public.business_profiles%rowtype; _plan public.bulk_dispatch_plans%rowtype; _thr int; _cnt int;
begin
  select * into _p from public.business_profiles where merchant_id=NEW.merchant_id;
  if _p.merchant_id is null or _p.dispatch_plan_id is null or _p.pricing_plan_id is null then return NEW; end if;
  select * into _plan from public.bulk_dispatch_plans where id=_p.dispatch_plan_id and is_active;
  if _plan.id is null or not _plan.qty_enabled then return NEW; end if;
  _thr := greatest(1, coalesce(_plan.qty_threshold, 10));
  select count(distinct o.receiver_id) into _cnt from public.business_orders o
   where o.merchant_id=NEW.merchant_id and o.status='pending' and o.pickup_point_id=NEW.pickup_point_id;
  if _cnt >= _thr then
    perform public.business_group_and_batch(NEW.merchant_id, 'qty', jsonb_build_object('pickup_point_id', NEW.pickup_point_id));
  end if;
  return NEW;
exception when others then
  raise warning 'business_orders_qty_check failed: %', sqlerrm;
  return NEW;
end $function$;

-- wake: also for planning runs
CREATE OR REPLACE FUNCTION public.business_batches_wake()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'vault', 'extensions'
AS $function$
declare _secret text; _ok boolean;
begin
  if not exists (select 1 from public.business_batches where status='planning')
     and not exists (select 1 from public.business_dispatch_runs where status='planning') then return; end if;
  update public.business_batch_wake_state set last_wake_at = now()
   where last_wake_at < now() - interval '15 seconds' returning true into _ok;
  if _ok is not true then return; end if;
  select decrypted_secret into _secret from vault.decrypted_secrets where name='courier_job_secret';
  if _secret is null then raise warning 'courier_job_secret missing'; return; end if;
  perform net.http_post(
    url := 'https://user.badiyos.com/api/public/business/process-batches',
    headers := jsonb_build_object('Content-Type','application/json','x-courier-job-secret', _secret),
    body := '{}'::jsonb);
exception when others then
  raise warning 'business_batches_wake failed: %', sqlerrm;
end $function$;

-- 5. Processor helpers (service only)
create or replace function public.business_claim_planning_runs(_limit integer default 3)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare _out jsonb := '[]'::jsonb; _r record; _plan public.bulk_dispatch_plans%rowtype;
begin
  for _r in
    update public.business_dispatch_runs set claimed_at=now()
     where id in (select id from public.business_dispatch_runs
                   where status='planning' and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                   order by created_at limit greatest(1, coalesce(_limit,3)) for update skip locked)
    returning *
  loop
    select p.* into _plan from public.business_profiles bp join public.bulk_dispatch_plans p on p.id=bp.dispatch_plan_id
     where bp.merchant_id=_r.merchant_id;
    _out := _out || jsonb_build_array(jsonb_build_object(
      'run_id', _r.id,
      'max_drops', greatest(1, coalesce(_plan.max_drops_per_batch, 10)),
      'service_minutes', coalesce(_plan.service_minutes_per_drop, 3),
      'pickup', (select jsonb_build_object('lat', pp.lat, 'lng', pp.lng) from public.business_pickup_points pp where pp.id=_r.pickup_point_id),
      'drops', coalesce((select jsonb_agg(jsonb_build_object('receiver_id', r.id, 'lat', r.lat, 'lng', r.lng))
                 from (select distinct o.receiver_id from public.business_orders o
                        where o.dispatch_run_id=_r.id and o.status='batched' and o.batch_id is null) d
                 join public.business_receivers r on r.id=d.receiver_id), '[]'::jsonb)));
  end loop;
  return _out;
end $function$;

create or replace function public.business_create_trip(_run_id uuid, _trip_no int, _receiver_order uuid[], _distance_km numeric, _distance_source text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare _run public.business_dispatch_runs%rowtype; _bid uuid; _zone uuid; _label text; _labels jsonb; _res jsonb; _n int;
begin
  select * into _run from public.business_dispatch_runs where id=_run_id for update;
  if _run.id is null or _run.status <> 'planning' then return jsonb_build_object('ok',false,'reason','RUN_NOT_PLANNING'); end if;
  _n := coalesce(array_length(_receiver_order,1),0);
  if _n = 0 then return jsonb_build_object('ok',false,'reason','NO_DROPS'); end if;

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

create or replace function public.business_complete_run(_run_id uuid, _method text, _total_km numeric, _skipped uuid[], _error text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare _released int; _trips int;
begin
  -- anything not placed on a trip goes back to pending
  update public.business_orders set status='pending', batched_at=null, dispatch_run_id=null
   where dispatch_run_id=_run_id and status='batched' and batch_id is null;
  get diagnostics _released = row_count;
  select count(*) into _trips from public.business_batches where dispatch_run_id=_run_id;
  update public.business_dispatch_runs
     set status = case when _trips = 0 and _error is not null then 'failed' else 'done' end,
         method=_method, trips=_trips, total_km=round(coalesce(_total_km,0),2),
         skipped=to_jsonb(coalesce(_skipped,'{}'::uuid[])), error=_error, claimed_at=null
   where id=_run_id;
  return jsonb_build_object('ok',true,'trips',_trips,'released_orders',_released);
end $function$;

-- retries: include fixed order + distance so a waiting trip is finalized as planned
CREATE OR REPLACE FUNCTION public.business_claim_planning_batches(_limit integer DEFAULT 5)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _out jsonb := '[]'::jsonb; _b record;
begin
  for _b in
    update public.business_batches set claimed_at=now()
     where id in (select id from public.business_batches
                   where status='planning' and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                   order by created_at limit greatest(1, coalesce(_limit,5)) for update skip locked)
    returning *
  loop
    _out := _out || jsonb_build_array(jsonb_build_object(
      'batch_id', _b.id,
      'receiver_order', to_jsonb(_b.receiver_order),
      'distance_km', _b.distance_km,
      'distance_source', _b.distance_source,
      'pickup', (select jsonb_build_object('lat', pp.lat, 'lng', pp.lng)
                   from public.business_pickup_points pp where pp.id=_b.pickup_point_id),
      'drops', coalesce((select jsonb_agg(jsonb_build_object('receiver_id', r.id, 'lat', r.lat, 'lng', r.lng))
                   from (select distinct o.receiver_id from public.business_orders o where o.batch_id=_b.id) d
                   join public.business_receivers r on r.id=d.receiver_id), '[]'::jsonb)
    ));
  end loop;
  return _out;
end $function$;

revoke all on function public.business_claim_planning_runs(int) from public, anon, authenticated;
revoke all on function public.business_create_trip(uuid,int,uuid[],numeric,text) from public, anon, authenticated;
revoke all on function public.business_complete_run(uuid,text,numeric,uuid[],text) from public, anon, authenticated;
grant execute on function public.business_claim_planning_runs(int) to service_role;
grant execute on function public.business_create_trip(uuid,int,uuid[],numeric,text) to service_role;
grant execute on function public.business_complete_run(uuid,text,numeric,uuid[],text) to service_role;

-- 6. Slot tick: runs + heads-up + stuck-run recovery
CREATE OR REPLACE FUNCTION public.business_slot_tick()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _r record; _t time; _now timestamptz := now(); _local timestamp := (now() at time zone 'Asia/Kolkata');
        _state public.business_dispatch_state%rowtype; _e record; _skill uuid;
begin
  select id into _skill from public.service_categories where slug='bulk-delivery' and is_active order by rank limit 1;
  for _r in
    select bp.merchant_id, bp.business_name, p.slot_times, p.slots_enabled
      from public.business_profiles bp
      join public.bulk_dispatch_plans p on p.id=bp.dispatch_plan_id and p.is_active
      join public.merchants m on m.id=bp.merchant_id
     where bp.pricing_plan_id is not null and p.slots_enabled
       and m.delivery_enabled and m.delivery_status='active'
  loop
    select * into _state from public.business_dispatch_state where merchant_id=_r.merchant_id;
    foreach _t in array coalesce(_r.slot_times, '{}'::time[]) loop
      -- heads-up 15 minutes before
      if _local::time >= (_t - interval '15 minutes') and _local::time < _t and _t >= time '00:15'
         and (_state.merchant_id is null or _state.last_notice_date is distinct from _local::date
              or _state.last_notice_time is null or _state.last_notice_time < _t) then
        insert into public.business_dispatch_state(merchant_id, last_notice_date, last_notice_time)
        values (_r.merchant_id, _local::date, _t)
        on conflict (merchant_id) do update set last_notice_date=excluded.last_notice_date, last_notice_time=excluded.last_notice_time;
        if _skill is not null then
          for _e in select e.id from public.experts e
                     where e.is_online and e.status='active'
                       and exists (select 1 from public.partner_skills ps where ps.expert_id=e.id and ps.status='approved' and ps.service_category_id=_skill)
          loop
            perform public.notify_push_event('expert', _e.id, 'bulk_slot_notice',
              to_char(_t,'HH12:MI AM') || ': trips ready soon at ' || coalesce(_r.business_name,'a business'),
              'Stay online to get these trips.', jsonb_build_object('type','bulk_slot_notice','route','/courier'));
          end loop;
        end if;
        select * into _state from public.business_dispatch_state where merchant_id=_r.merchant_id;
      end if;

      if _local::time >= _t
         and (_state.merchant_id is null
              or _state.last_slot_date is distinct from _local::date
              or _state.last_slot_time is null or _state.last_slot_time < _t) then
        perform public.business_group_and_batch(_r.merchant_id, 'slot', null);
        insert into public.business_dispatch_state(merchant_id, last_slot_date, last_slot_time)
        values (_r.merchant_id, _local::date, _t)
        on conflict (merchant_id) do update set last_slot_date=excluded.last_slot_date, last_slot_time=excluded.last_slot_time;
        select * into _state from public.business_dispatch_state where merchant_id=_r.merchant_id;
      end if;
    end loop;
  end loop;

  update public.business_batches set status='planning', claimed_at=null
   where status='awaiting_balance' and updated_at < _now - interval '2 minutes';
  update public.business_batches set claimed_at=null
   where status='planning' and claimed_at is not null and claimed_at < _now - interval '5 minutes';
  update public.business_dispatch_runs set claimed_at=null
   where status='planning' and claimed_at is not null and claimed_at < _now - interval '5 minutes';

  perform public.business_batches_wake();
exception when others then
  raise warning 'business_slot_tick failed: %', sqlerrm;
end $function$;

-- 7. No rider: business trips keep searching, flagged for ops
CREATE OR REPLACE FUNCTION public.courier_sweeper()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _r record; _timeout int; _expire int; _delay int; _step numeric; _max numeric;
begin
  begin
    _timeout := public.courier_setting('courier_search_timeout_minutes', 5)::int;
    _expire  := public.courier_setting('courier_unpaid_expire_minutes', 15)::int;
    _delay   := public.courier_setting('courier_settlement_delay_minutes', 0)::int;
    select coalesce(radius_expand_step_km,1), coalesce(radius_expand_max_km,10) into _step, _max from public.dispatch_config limit 1;
    _step := coalesce(_step,1); _max := coalesce(_max,10);

    update public.courier_offers set status='expired', responded_at=now() where status='pending' and expires_at <= now();

    for _r in select id, customer_id from public.courier_orders
               where status='REQUESTED' and payment_status='pending' and created_at < now() - make_interval(mins => _expire)
    loop
      perform set_config('app.courier_actor_type','system',true);
      update public.courier_orders set status='CANCELLED', cancelled_by='system', cancelled_at=now(), cancel_reason_code='unpaid_expired' where id=_r.id;
    end loop;

    for _r in select id, customer_id, search_started_at, current_search_radius_km, store_order_id, needs_ops_attention, total_amount, source
                from public.courier_orders where status='SEARCHING'
    loop
      if _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout)
         and _r.store_order_id is not null then
        if not coalesce(_r.needs_ops_attention,false) then
          update public.courier_orders set needs_ops_attention = true where id = _r.id;
          update public.merchant_orders set needs_attention = true where id = _r.store_order_id;
          perform public.store_audit(_r.store_order_id, 'store_no_expert_found', null, jsonb_build_object('courier_order_id', _r.id));
          perform public.admin_alert_enqueue('store_no_expert', _r.store_order_id, 'Store order - no Expert found', null, _r.total_amount, 'Now');
        end if;
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          perform public.courier_dispatch_next(_r.id);
        end if;
      elsif _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout)
         and _r.source = 'business' then
        -- business trip: never auto-cancel; show as Unassigned to ops and keep searching
        if not coalesce(_r.needs_ops_attention,false) then
          update public.courier_orders set needs_ops_attention = true where id = _r.id;
        end if;
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          update public.courier_orders set current_search_radius_km = least(_max, coalesce(current_search_radius_km, 5) + _step) where id=_r.id;
          perform public.courier_dispatch_next(_r.id);
        end if;
      elsif _r.search_started_at is not null and _r.search_started_at < now() - make_interval(mins => _timeout) then
        perform set_config('app.courier_actor_type','system',true);
        update public.courier_orders set status='CANCELLED', cancelled_by='system', cancelled_at=now(), cancel_reason_code='no_rider_found' where id=_r.id;
        update public.courier_offers set status='cancelled' where order_id=_r.id and status='pending';
        perform public.courier_mark_refund_pending(_r.id, (select total_amount from public.courier_orders where id=_r.id), 'no_rider_found');
        perform public.notify_customer_user_push(_r.customer_id, 'No rider available', 'We could not find a rider. Your payment is being refunded.', 'home');
      else
        if not exists (select 1 from public.courier_offers where order_id=_r.id and status='pending' and expires_at > now()) then
          update public.courier_orders set current_search_radius_km = least(_max, coalesce(current_search_radius_km, 5) + _step) where id=_r.id;
          perform public.courier_dispatch_next(_r.id);
        end if;
      end if;
    end loop;

    for _r in select id from public.courier_orders
               where status='DELIVERED' and earnings_credited_at is null and delivered_at < now() - make_interval(mins => _delay)
    loop
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;
  exception when others then raise warning 'courier_sweeper failed: %', sqlerrm;
  end;
  perform public.store_sweeper();
end $function$;

-- Ops: list unassigned business trips, reject one
create or replace function public.staff_list_unassigned_business_trips()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.business_require_ops();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'courier_order_id', c.id, 'order_code', c.order_code, 'status', c.status,
      'merchant_id', c.business_merchant_id, 'business_name', bp.business_name,
      'trip_no', b.trip_no, 'trip_label', b.trip_label, 'drops', b.drops_count,
      'total_amount', c.total_amount, 'search_started_at', c.search_started_at,
      'needs_ops_attention', c.needs_ops_attention) order by c.created_at)
    from public.courier_orders c
    left join public.business_batches b on b.courier_order_id=c.id
    left join public.business_profiles bp on bp.merchant_id=c.business_merchant_id
   where c.source='business' and c.status in ('REQUESTED','SEARCHING') and c.assigned_expert_id is null), '[]'::jsonb);
end $function$;

create or replace function public.staff_business_reject_trip(_batch_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare _ok boolean; _b public.business_batches%rowtype; _old jsonb;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into _b from public.business_batches where id=_batch_id for update;
  if _b.id is null or _b.courier_order_id is null then raise exception 'Trip not found'; end if;
  _old := to_jsonb(_b);
  -- single refund happens in business_sync_from_order ('refund:<order id>')
  _ok := public.business_reject_trip_internal(_b.courier_order_id, 'STAFF_REJECTED');
  if not _ok then raise exception 'Trip is not an unassigned business trip'; end if;
  update public.business_batches set status='rejected', fail_reason=left('REJECTED: '||btrim(_reason),200) where id=_batch_id;
  perform public.business_audit('staff_business_reject_trip','business_batches',_batch_id,_old,
    (select to_jsonb(x) from public.business_batches x where id=_batch_id), btrim(_reason));
  return jsonb_build_object('ok', true, 'amount', _b.total_amount);
end $function$;
revoke all on function public.staff_list_unassigned_business_trips() from public, anon;
revoke all on function public.staff_business_reject_trip(uuid,text) from public, anon;
grant execute on function public.staff_list_unassigned_business_trips() to authenticated;
grant execute on function public.staff_business_reject_trip(uuid,text) to authenticated;

-- 8. Business code view with trip labels
CREATE OR REPLACE FUNCTION public.business_get_trip_otps(_courier_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _o public.courier_orders%rowtype; _b public.business_batches%rowtype;
begin
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _o.id is null or _o.source is distinct from 'business' or _o.business_merchant_id is distinct from _mid then
    raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _b from public.business_batches where courier_order_id=_o.id limit 1;
  return jsonb_build_object('order_id',_o.id,'order_code',_o.order_code,'status',_o.status,
    'trip_no',_b.trip_no,'trip_label',_b.trip_label,
    'stops', coalesce((select jsonb_agg(jsonb_build_object(
      'stop_id',s.id,'stop_type',s.stop_type,'sequence',s.sequence,'address',s.address,
      'drop_label', case when s.stop_type='drop' then 'C' || (s.sequence - 1) end,
      'receiver_name', coalesce((select r.name from public.business_orders bo join public.business_receivers r on r.id=bo.receiver_id
                                  where bo.drop_stop_id=s.id limit 1), s.contact_name),
      'contact_name',s.contact_name,'contact_phone',s.contact_phone,'status',s.status,
      'reference_nos',(select jsonb_agg(bo.reference_no) from public.business_orders bo where bo.drop_stop_id=s.id and bo.reference_no is not null),
      'otp',public.courier_stop_visible_otp(s.id)) order by s.sequence)
      from public.courier_order_stops s where s.order_id=_o.id),'[]'::jsonb));
end $function$;
