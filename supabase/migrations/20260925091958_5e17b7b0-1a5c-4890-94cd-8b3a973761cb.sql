-- =============================================================
-- Business order batching engine (backend only)
-- =============================================================

create table if not exists public.business_batches (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  pickup_point_id uuid not null references public.business_pickup_points(id),
  zone_id uuid,
  trigger text not null check (trigger in ('manual','qty','slot')),
  status text not null default 'planning' check (status in ('planning','awaiting_balance','dispatched','failed','completed')),
  fail_reason text,
  drops_count int not null default 0,
  distance_km numeric,
  distance_source text,
  fare_breakdown jsonb not null default '{}'::jsonb,
  total_amount numeric not null default 0,
  courier_order_id uuid references public.courier_orders(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.business_batches to authenticated;
grant all on public.business_batches to service_role;
alter table public.business_batches enable row level security;

drop policy if exists "business batches readable by owner and ops" on public.business_batches;
create policy "business batches readable by owner and ops"
on public.business_batches for select to authenticated
using (
  public.courier_is_ops_staff()
  or (merchant_id = public.current_merchant_id() and public.merchant_caller_has_perm('manage_delivery'))
);

drop trigger if exists business_batches_touch on public.business_batches;
create trigger business_batches_touch before update on public.business_batches
for each row execute function public.business_touch();

create index if not exists business_batches_status_idx on public.business_batches(status, created_at);
create index if not exists business_batches_merchant_idx on public.business_batches(merchant_id, created_at desc);

alter table public.business_orders add column if not exists batch_id uuid references public.business_batches(id);
create index if not exists business_orders_batch_idx on public.business_orders(batch_id);
create index if not exists business_orders_pending_idx on public.business_orders(merchant_id, status);

alter table public.courier_orders add column if not exists business_merchant_id uuid references public.merchants(id);
create index if not exists courier_orders_business_idx on public.courier_orders(business_merchant_id);

create table if not exists public.business_dispatch_state (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  last_slot_date date,
  last_slot_time time
);
grant all on public.business_dispatch_state to service_role;
alter table public.business_dispatch_state enable row level security;

create table if not exists public.business_batch_wake_state (
  id boolean primary key default true check (id),
  last_wake_at timestamptz not null default (now() - interval '1 hour')
);
grant all on public.business_batch_wake_state to service_role;
alter table public.business_batch_wake_state enable row level security;
insert into public.business_batch_wake_state(id) values (true) on conflict do nothing;

-- -------------------------------------------------------------
-- Wake the background distance/finalize endpoint (throttled)
-- -------------------------------------------------------------
create or replace function public.business_batches_wake()
returns void language plpgsql security definer set search_path to 'public','vault','extensions' as $$
declare _secret text; _ok boolean;
begin
  if not exists (select 1 from public.business_batches where status='planning') then return; end if;

  update public.business_batch_wake_state
     set last_wake_at = now()
   where last_wake_at < now() - interval '15 seconds'
  returning true into _ok;
  if _ok is not true then return; end if;

  select decrypted_secret into _secret from vault.decrypted_secrets where name='courier_job_secret';
  if _secret is null then raise warning 'courier_job_secret missing'; return; end if;

  perform net.http_post(
    url := 'https://user.badiyos.com/api/public/business/process-batches',
    headers := jsonb_build_object('Content-Type','application/json','x-courier-job-secret', _secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning 'business_batches_wake failed: %', sqlerrm;
end $$;

revoke all on function public.business_batches_wake() from public, anon, authenticated;

-- -------------------------------------------------------------
-- Grouping + batching (internal)
-- -------------------------------------------------------------
create or replace function public.business_group_and_batch(_merchant_id uuid, _trigger text, _group_filter jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  _p record; _plan public.bulk_dispatch_plans%rowtype; _st jsonb;
  _cap int; _g record; _batch_id uuid; _ids uuid[]; _recv uuid[]; _n int;
  _created int := 0; _r record; _chunk uuid[]; _chunk_recv uuid[];
begin
  select * into _p from public.business_profiles where merchant_id=_merchant_id;
  if _p.merchant_id is null or _p.pricing_plan_id is null or _p.dispatch_plan_id is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_PLAN', 'batches', 0);
  end if;
  select * into _plan from public.bulk_dispatch_plans where id=_p.dispatch_plan_id and is_active;
  if _plan.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_PLAN', 'batches', 0); end if;

  _st := public.service_effective_state('courier', null, now());
  if not coalesce((_st->>'can_order')::boolean, true) then
    return jsonb_build_object('ok', false, 'reason', 'SERVICE_CLOSED', 'batches', 0);
  end if;

  _cap := greatest(1, least(coalesce(_plan.max_drops_per_batch, 10), coalesce(_p.batch_capacity, 10)));

  -- Lock the pending orders we are about to take.
  create temp table if not exists _bg_orders (
    order_id uuid, receiver_id uuid, pickup_point_id uuid, zone_id uuid
  ) on commit drop;
  delete from _bg_orders;

  for _r in
    select o.id, o.receiver_id, o.pickup_point_id, r.lat, r.lng
      from public.business_orders o
      join public.business_receivers r on r.id=o.receiver_id
     where o.merchant_id=_merchant_id and o.status='pending'
       and (_group_filter is null
            or ((_group_filter->>'pickup_point_id') is null or o.pickup_point_id = (_group_filter->>'pickup_point_id')::uuid))
     order by o.created_at
     for update of o skip locked
  loop
    insert into _bg_orders(order_id, receiver_id, pickup_point_id, zone_id)
    values (_r.id, _r.receiver_id, _r.pickup_point_id,
            nullif(public.courier_check_serviceability(_r.lat, _r.lng)->>'zone_id','')::uuid);
  end loop;

  for _g in select pickup_point_id, zone_id from _bg_orders where zone_id is not null group by 1,2 loop
    -- distinct receivers in this group, in insertion order
    select array_agg(receiver_id order by receiver_id) into _recv
      from (select distinct receiver_id from _bg_orders
             where pickup_point_id=_g.pickup_point_id and zone_id is not distinct from _g.zone_id) q;

    while array_length(_recv,1) > 0 loop
      _chunk_recv := _recv[1:least(_cap, array_length(_recv,1))];
      if array_length(_recv,1) > _cap then _recv := _recv[_cap+1:array_length(_recv,1)]; else _recv := '{}'; end if;

      select array_agg(order_id) into _chunk from _bg_orders
       where pickup_point_id=_g.pickup_point_id and zone_id is not distinct from _g.zone_id
         and receiver_id = any(_chunk_recv);

      insert into public.business_batches(merchant_id, pickup_point_id, zone_id, trigger, status, drops_count)
      values (_merchant_id, _g.pickup_point_id, _g.zone_id, _trigger, 'planning', coalesce(array_length(_chunk_recv,1),0))
      returning id into _batch_id;

      update public.business_orders
         set status='batched', batch_id=_batch_id, batched_at=now()
       where id = any(_chunk);

      _created := _created + 1;
    end loop;
  end loop;

  if _created > 0 then perform public.business_batches_wake(); end if;
  return jsonb_build_object('ok', true, 'batches', _created);
end $$;

revoke all on function public.business_group_and_batch(uuid, text, jsonb) from public, anon, authenticated;

-- -------------------------------------------------------------
-- Triggers for dispatch
-- -------------------------------------------------------------
create or replace function public.business_dispatch_now(_actor_label text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _mid uuid := public.business_require_delivery(); _plan public.bulk_dispatch_plans%rowtype; _res jsonb;
begin
  select p.* into _plan from public.business_profiles bp
    join public.bulk_dispatch_plans p on p.id=bp.dispatch_plan_id
   where bp.merchant_id=_mid;
  if _plan.id is null then raise exception 'No dispatch plan assigned'; end if;
  if not _plan.manual_enabled then raise exception 'Manual dispatch is not allowed on your plan'; end if;
  _res := public.business_group_and_batch(_mid, 'manual', null);
  perform public.business_audit('business_dispatch_now','business_batches',null,null,_res,_actor_label);
  return _res;
end $$;

create or replace function public.staff_business_dispatch_now(_merchant_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _res jsonb;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  _res := public.business_group_and_batch(_merchant_id, 'manual', null);
  perform public.business_audit('staff_business_dispatch_now','merchants',_merchant_id,null,
    jsonb_build_object('reason',_reason,'result',_res), null);
  return _res;
end $$;

revoke all on function public.business_dispatch_now(text) from public, anon;
revoke all on function public.staff_business_dispatch_now(uuid, text) from public, anon;
grant execute on function public.business_dispatch_now(text) to authenticated;
grant execute on function public.staff_business_dispatch_now(uuid, text) to authenticated;

-- qty trigger after a new business order
create or replace function public.business_orders_qty_check()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _p public.business_profiles%rowtype; _plan public.bulk_dispatch_plans%rowtype;
        _thr int; _cnt int; _zone uuid;
begin
  select * into _p from public.business_profiles where merchant_id=NEW.merchant_id;
  if _p.merchant_id is null or _p.dispatch_plan_id is null or _p.pricing_plan_id is null then return NEW; end if;
  select * into _plan from public.bulk_dispatch_plans where id=_p.dispatch_plan_id and is_active;
  if _plan.id is null or not _plan.qty_enabled then return NEW; end if;

  _thr := greatest(1, coalesce(_plan.qty_threshold, _p.qty_threshold, 10));
  select nullif(public.courier_check_serviceability(r.lat, r.lng)->>'zone_id','')::uuid into _zone
    from public.business_receivers r where r.id=NEW.receiver_id;
  if _zone is null then return NEW; end if;

  select count(distinct o.receiver_id) into _cnt
    from public.business_orders o join public.business_receivers r on r.id=o.receiver_id
   where o.merchant_id=NEW.merchant_id and o.status='pending'
     and o.pickup_point_id=NEW.pickup_point_id
     and nullif(public.courier_check_serviceability(r.lat, r.lng)->>'zone_id','')::uuid = _zone;

  if _cnt >= _thr then
    perform public.business_group_and_batch(NEW.merchant_id, 'qty',
      jsonb_build_object('pickup_point_id', NEW.pickup_point_id));
  end if;
  return NEW;
exception when others then
  raise warning 'business_orders_qty_check failed: %', sqlerrm;
  return NEW;
end $$;

drop trigger if exists business_orders_qty_check on public.business_orders;
create trigger business_orders_qty_check after insert on public.business_orders
for each row execute function public.business_orders_qty_check();

-- -------------------------------------------------------------
-- Slot tick (called from the existing courier sweeper)
-- -------------------------------------------------------------
create or replace function public.business_slot_tick()
returns void language plpgsql security definer set search_path to 'public' as $$
declare _r record; _t time; _now timestamptz := now(); _local timestamp := (now() at time zone 'Asia/Kolkata');
        _state public.business_dispatch_state%rowtype;
begin
  for _r in
    select bp.merchant_id, p.slot_times, p.slots_enabled
      from public.business_profiles bp
      join public.bulk_dispatch_plans p on p.id=bp.dispatch_plan_id and p.is_active
      join public.merchants m on m.id=bp.merchant_id
     where bp.pricing_plan_id is not null and p.slots_enabled
       and m.delivery_enabled and m.delivery_status='active'
  loop
    select * into _state from public.business_dispatch_state where merchant_id=_r.merchant_id;
    foreach _t in array coalesce(_r.slot_times, '{}'::time[]) loop
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

  -- retry batches waiting on balance, and re-wake stuck planning batches
  update public.business_batches set status='planning', claimed_at=null
   where status='awaiting_balance' and updated_at < _now - interval '2 minutes';
  update public.business_batches set claimed_at=null
   where status='planning' and claimed_at is not null and claimed_at < _now - interval '5 minutes';

  perform public.business_batches_wake();
exception when others then
  raise warning 'business_slot_tick failed: %', sqlerrm;
end $$;

revoke all on function public.business_slot_tick() from public, anon, authenticated;

-- -------------------------------------------------------------
-- Claim planning batches for the background worker (service only)
-- -------------------------------------------------------------
create or replace function public.business_claim_planning_batches(_limit int default 5)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
      'pickup', (select jsonb_build_object('lat', pp.lat, 'lng', pp.lng)
                   from public.business_pickup_points pp where pp.id=_b.pickup_point_id),
      'drops', coalesce((select jsonb_agg(jsonb_build_object('receiver_id', r.id, 'lat', r.lat, 'lng', r.lng))
                   from (select distinct o.receiver_id from public.business_orders o where o.batch_id=_b.id) d
                   join public.business_receivers r on r.id=d.receiver_id), '[]'::jsonb)
    ));
  end loop;
  return _out;
end $$;

revoke all on function public.business_claim_planning_batches(int) from public, anon, authenticated;

-- -------------------------------------------------------------
-- Create the courier order for a batch (internal)
-- -------------------------------------------------------------
create or replace function public.courier_create_business_order(
  _batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[],
  _fare jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _b public.business_batches%rowtype; _p public.business_profiles%rowtype; _m public.merchants%rowtype;
        _pp public.business_pickup_points%rowtype; _cid uuid; _seq int := 1; _sid uuid; _pick_sid uuid;
        _r public.business_receivers%rowtype; _first_drop public.business_receivers%rowtype; _pid uuid;
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

  foreach _pid in array _receiver_order loop
    select * into _r from public.business_receivers where id=_pid;
    _seq := _seq + 1;
    insert into public.courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone)
    values (_cid, 'drop', _seq, _r.lat, _r.lng, _r.address, coalesce(_r.contact_name, _r.name), _r.contact_phone)
    returning id into _sid;

    insert into public.courier_order_parcels(order_id, pickup_stop_id, drop_stop_id, description)
    values (_cid, _pick_sid, _sid,
      coalesce((select string_agg(coalesce(o.reference_no, o.description, 'Parcel'), ', ')
                  from public.business_orders o where o.batch_id=_batch_id and o.receiver_id=_pid), 'Parcel'))
    returning id into _pid;

    update public.business_orders
       set status='in_transit', courier_order_id=_cid, drop_stop_id=_sid, parcel_id=_pid
     where batch_id=_batch_id and receiver_id = (select id from public.business_receivers where id=_r.id);
  end loop;

  return _cid;
end $$;

revoke all on function public.courier_create_business_order(uuid, numeric, text, uuid[], jsonb) from public, anon, authenticated;

-- -------------------------------------------------------------
-- Finalize a batch: fare -> wallet -> courier order -> dispatch
-- -------------------------------------------------------------
create or replace function public.business_finalize_batch(
  _batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
    'commission_pct', coalesce(_pl.commission_pct,0));

  if coalesce(_m.delivery_wallet_balance,0) < _total then
    update public.business_batches
       set status='awaiting_balance', fail_reason='LOW_BALANCE', total_amount=_total,
           fare_breakdown=_fb, distance_km=_distance_km, distance_source=_distance_source, claimed_at=null
     where id=_batch_id;
    begin
      perform public.notify_customer_user_push(_m.auth_user_id, 'Low wallet balance',
        'Top up to dispatch ' || (select count(*) from public.business_orders where batch_id=_batch_id) || ' orders', null);
    exception when others then null; end;
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
  update public.business_orders set status='pending', batch_id=null, batched_at=null where batch_id=_batch_id and status='batched';
  return jsonb_build_object('ok', false, 'reason', left(sqlerrm,200));
end $$;

revoke all on function public.business_finalize_batch(uuid, numeric, text, uuid[]) from public, anon, authenticated;

-- -------------------------------------------------------------
-- Hook the slot tick into the existing sweeper (only addition)
-- -------------------------------------------------------------
create or replace function public.courier_sweeper_tick()
returns void language plpgsql security definer set search_path to 'public' as $$
declare _r record; _esc int;
begin
  perform public.courier_sweeper();
  perform public.courier_dispatch_refund_job();
  begin
    _esc := public.courier_setting('courier_return_payment_escalation_minutes', 15)::int;
    for _r in select distinct o.id, o.order_code, o.total_amount
                from public.courier_order_stops s
                join public.courier_orders o on o.id=s.order_id
               where s.stop_type='return' and s.status='arrived'
                 and s.arrived_at < now() - make_interval(mins => _esc)
                 and not coalesce(o.needs_ops_attention,false)
                 and exists (select 1 from public.courier_order_charges c
                              join public.courier_order_parcels p on p.id=c.parcel_id
                             where p.return_stop_id=s.id and c.status='pending') loop
      update public.courier_orders set needs_ops_attention=true where id=_r.id;
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_r.id, (select status from public.courier_orders where id=_r.id), (select status from public.courier_orders where id=_r.id), 'system', null, jsonb_build_object('event','return_payment_escalated'));
      perform public.admin_alert_enqueue('courier_return_payment', _r.id, coalesce(_r.order_code,'Parcel return'),
                                         'Return charge unpaid', _r.total_amount, 'Now');
    end loop;

    for _r in select id from public.courier_orders
               where earnings_credited_at is null
                 and ((status='CANCELLED' and cancel_reason_code='ALL_PICKUPS_FAILED')
                      or (status='FAILED_DELIVERY' and incident_code is null)) loop
      if (select status from public.courier_orders where id=_r.id) = 'FAILED_DELIVERY'
         and not public.courier_order_clean_return(_r.id) then continue; end if;
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;
  exception when others then raise warning 'courier_sweeper_tick extras failed: %', sqlerrm;
  end;

  begin
    perform public.business_slot_tick();
  exception when others then raise warning 'business_slot_tick failed: %', sqlerrm;
  end;
end $$;
