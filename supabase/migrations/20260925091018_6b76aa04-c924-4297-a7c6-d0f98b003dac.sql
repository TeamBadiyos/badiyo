-- 1. Plans
create table public.bulk_pricing_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_fare numeric not null default 0 check (base_fare >= 0),
  included_km numeric not null default 0 check (included_km >= 0),
  per_km numeric not null default 0 check (per_km >= 0),
  min_fare numeric not null default 0 check (min_fare >= 0),
  extra_drop_fee numeric not null default 0 check (extra_drop_fee >= 0),
  return_per_km numeric not null default 0 check (return_per_km >= 0),
  commission_pct numeric not null default 0 check (commission_pct between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.bulk_pricing_plans to authenticated;
grant all on public.bulk_pricing_plans to service_role;
alter table public.bulk_pricing_plans enable row level security;
create policy "bulk_pricing_plans ops read" on public.bulk_pricing_plans for select to authenticated using (public.courier_is_ops_staff());
create trigger bulk_pricing_plans_touch before update on public.bulk_pricing_plans for each row execute function public.business_touch();

create table public.bulk_dispatch_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manual_enabled boolean not null default true,
  qty_enabled boolean not null default false,
  qty_threshold int,
  slots_enabled boolean not null default false,
  slot_times time[] not null default '{}',
  max_drops_per_batch int not null default 10 check (max_drops_per_batch between 1 and 50),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bulk_dispatch_one_mode check (manual_enabled or qty_enabled or slots_enabled),
  constraint bulk_dispatch_qty check (not qty_enabled or coalesce(qty_threshold,0) >= 1),
  constraint bulk_dispatch_slots check (not slots_enabled or cardinality(slot_times) >= 1)
);
grant select on public.bulk_dispatch_plans to authenticated;
grant all on public.bulk_dispatch_plans to service_role;
alter table public.bulk_dispatch_plans enable row level security;
create policy "bulk_dispatch_plans ops read" on public.bulk_dispatch_plans for select to authenticated using (public.courier_is_ops_staff());

create or replace function public.bulk_dispatch_normalize() returns trigger language plpgsql set search_path=public as $$
begin
  NEW.slot_times := coalesce((select array_agg(distinct x order by x) from unnest(NEW.slot_times) x where x is not null), '{}');
  NEW.updated_at := now();
  return NEW;
end $$;
create trigger bulk_dispatch_plans_norm before insert or update on public.bulk_dispatch_plans for each row execute function public.bulk_dispatch_normalize();

-- 2. Profile links
alter table public.business_profiles
  add column pricing_plan_id uuid references public.bulk_pricing_plans(id),
  add column dispatch_plan_id uuid references public.bulk_dispatch_plans(id);

-- 3. Business orders
create table public.business_orders (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id),
  receiver_id uuid not null references public.business_receivers(id),
  pickup_point_id uuid not null references public.business_pickup_points(id),
  reference_no text,
  description text,
  packet_count int not null default 1 check (packet_count between 1 and 50),
  status text not null default 'pending' check (status in ('pending','batched','in_transit','delivered','returned','failed','cancelled')),
  courier_order_id uuid references public.courier_orders(id),
  parcel_id uuid references public.courier_order_parcels(id),
  drop_stop_id uuid references public.courier_order_stops(id),
  created_by_label text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  batched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);
grant select on public.business_orders to authenticated;
grant all on public.business_orders to service_role;
alter table public.business_orders enable row level security;
create policy "business_orders read" on public.business_orders for select to authenticated
  using ((merchant_id = public.current_merchant_id() and public.merchant_caller_has_perm('manage_delivery')) or public.courier_is_ops_staff());
create index business_orders_merchant_idx on public.business_orders(merchant_id, status, created_at desc);
create unique index business_orders_pending_ref_uq on public.business_orders(merchant_id, receiver_id, lower(btrim(reference_no)))
  where status='pending' and coalesce(btrim(reference_no),'') <> '';
create trigger business_orders_touch before update on public.business_orders for each row execute function public.business_touch();

-- 4. Staff RPCs
create or replace function public.staff_upsert_pricing_plan(_id uuid, _name text, _base_fare numeric, _included_km numeric, _per_km numeric,
  _min_fare numeric, _extra_drop_fee numeric, _return_per_km numeric, _commission_pct numeric, _is_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare _old jsonb; _new public.bulk_pricing_plans;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if _id is null then
    insert into public.bulk_pricing_plans(name,base_fare,included_km,per_km,min_fare,extra_drop_fee,return_per_km,commission_pct,is_active)
    values (btrim(_name),_base_fare,_included_km,_per_km,_min_fare,_extra_drop_fee,_return_per_km,_commission_pct,coalesce(_is_active,true)) returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_pricing_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.pricing_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_pricing_plans set name=btrim(_name),base_fare=_base_fare,included_km=_included_km,per_km=_per_km,min_fare=_min_fare,
      extra_drop_fee=_extra_drop_fee,return_per_km=_return_per_km,commission_pct=_commission_pct,is_active=coalesce(_is_active,true)
      where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_pricing_plan','bulk_pricing_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $$;

create or replace function public.staff_upsert_dispatch_plan(_id uuid, _name text, _manual_enabled boolean, _qty_enabled boolean, _qty_threshold int,
  _slots_enabled boolean, _slot_times time[], _max_drops_per_batch int, _is_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare _old jsonb; _new public.bulk_dispatch_plans;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_name),'')='' then raise exception 'Name is required'; end if;
  if _id is null then
    insert into public.bulk_dispatch_plans(name,manual_enabled,qty_enabled,qty_threshold,slots_enabled,slot_times,max_drops_per_batch,is_active)
    values (btrim(_name),coalesce(_manual_enabled,false),coalesce(_qty_enabled,false),_qty_threshold,coalesce(_slots_enabled,false),coalesce(_slot_times,'{}'),_max_drops_per_batch,coalesce(_is_active,true))
    returning * into _new;
  else
    select to_jsonb(p) into _old from public.bulk_dispatch_plans p where id=_id for update;
    if _old is null then raise exception 'Plan not found'; end if;
    if (_old->>'is_active')::boolean and not coalesce(_is_active,true)
       and exists (select 1 from public.business_profiles b join public.merchants m on m.id=b.merchant_id where b.dispatch_plan_id=_id and m.delivery_status='active') then
      raise exception 'Plan is assigned to an active business; use staff_set_plan_active'; end if;
    update public.bulk_dispatch_plans set name=btrim(_name),manual_enabled=coalesce(_manual_enabled,false),qty_enabled=coalesce(_qty_enabled,false),
      qty_threshold=_qty_threshold,slots_enabled=coalesce(_slots_enabled,false),slot_times=coalesce(_slot_times,'{}'),
      max_drops_per_batch=_max_drops_per_batch,is_active=coalesce(_is_active,true) where id=_id returning * into _new;
  end if;
  perform public.business_audit('staff_upsert_dispatch_plan','bulk_dispatch_plans',_new.id,_old,to_jsonb(_new),null);
  return _new.id;
end $$;

create or replace function public.staff_set_plan_active(_kind text, _id uuid, _active boolean, _reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare _used int;
begin
  perform public.business_require_ops();
  if _kind not in ('pricing','dispatch') then raise exception 'Kind must be pricing or dispatch'; end if;
  select count(*) into _used from public.business_profiles b join public.merchants m on m.id=b.merchant_id
   where m.delivery_status='active' and case when _kind='pricing' then b.pricing_plan_id=_id else b.dispatch_plan_id=_id end;
  if not _active and _used > 0 then
    return jsonb_build_object('ok',false,'reason','in_use','used_by',_used);
  end if;
  if _kind='pricing' then
    update public.bulk_pricing_plans set is_active=_active where id=_id;
  else
    update public.bulk_dispatch_plans set is_active=_active where id=_id;
  end if;
  if not found then raise exception 'Plan not found'; end if;
  perform public.business_audit('staff_set_plan_active', case when _kind='pricing' then 'bulk_pricing_plans' else 'bulk_dispatch_plans' end, _id,
    null, jsonb_build_object('is_active',_active,'reason',_reason), null);
  return jsonb_build_object('ok',true,'used_by',_used);
end $$;

create or replace function public.staff_assign_business_plans(_merchant_id uuid, _pricing_plan_id uuid, _dispatch_plan_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare _old jsonb; _new public.business_profiles;
begin
  perform public.business_require_ops();
  select to_jsonb(b) into _old from public.business_profiles b where merchant_id=_merchant_id for update;
  if _old is null then raise exception 'Business profile not found'; end if;
  if _pricing_plan_id is not null and not exists (select 1 from public.bulk_pricing_plans where id=_pricing_plan_id and is_active) then
    raise exception 'Pricing plan not found or inactive'; end if;
  if _dispatch_plan_id is not null and not exists (select 1 from public.bulk_dispatch_plans where id=_dispatch_plan_id and is_active) then
    raise exception 'Dispatch plan not found or inactive'; end if;
  update public.business_profiles set pricing_plan_id=_pricing_plan_id, dispatch_plan_id=_dispatch_plan_id
   where merchant_id=_merchant_id returning * into _new;
  perform public.business_audit('staff_assign_business_plans','business_profiles',_merchant_id,_old,to_jsonb(_new),null);
end $$;

create or replace function public.staff_list_bulk_plans()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.business_require_ops();
  return jsonb_build_object(
    'pricing', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('used_by',
        (select count(*) from public.business_profiles b where b.pricing_plan_id=p.id)) order by p.name) from public.bulk_pricing_plans p),'[]'::jsonb),
    'dispatch', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('used_by',
        (select count(*) from public.business_profiles b where b.dispatch_plan_id=d.id)) order by d.name) from public.bulk_dispatch_plans d),'[]'::jsonb));
end $$;

-- 5. Business profile (old batching fields no longer returned)
create or replace function public.business_get_profile()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare _mid uuid := public.business_require_delivery(); _b public.business_profiles;
begin
  select * into _b from public.business_profiles where merchant_id=_mid;
  return jsonb_build_object(
    'profile', case when _b.merchant_id is null then null else jsonb_build_object(
      'merchant_id',_b.merchant_id,'business_name',_b.business_name,'gstin',_b.gstin,'city',_b.city,
      'vehicle_type_id',_b.vehicle_type_id,'courier_type_id',_b.courier_type_id,'low_balance_threshold',_b.low_balance_threshold,
      'pricing_plan_id',_b.pricing_plan_id,'dispatch_plan_id',_b.dispatch_plan_id,'created_at',_b.created_at,'updated_at',_b.updated_at) end,
    'pricing_plan', (select jsonb_build_object('name',p.name,'base_fare',p.base_fare,'included_km',p.included_km,'per_km',p.per_km,
        'min_fare',p.min_fare,'extra_drop_fee',p.extra_drop_fee,'return_per_km',p.return_per_km)
        from public.bulk_pricing_plans p where p.id=_b.pricing_plan_id),
    'dispatch_plan', (select jsonb_build_object('name',d.name,'manual_enabled',d.manual_enabled,'qty_enabled',d.qty_enabled,
        'qty_threshold',d.qty_threshold,'slots_enabled',d.slots_enabled,'slot_times',to_jsonb(d.slot_times),'max_drops_per_batch',d.max_drops_per_batch)
        from public.bulk_dispatch_plans d where d.id=_b.dispatch_plan_id),
    'pickup_points', coalesce((select jsonb_agg(to_jsonb(p) order by p.is_default desc, p.created_at) from public.business_pickup_points p where merchant_id=_mid),'[]'::jsonb));
end $$;

-- 6. Business order RPCs
create or replace function public.business_order_insert(_mid uuid, _receiver_id uuid, _pickup_point_id uuid, _reference_no text,
  _description text, _packet_count int, _actor_label text)
returns uuid language plpgsql security definer set search_path=public as $$
declare _pp uuid := _pickup_point_id; _ref text := nullif(btrim(coalesce(_reference_no,'')),''); _new public.business_orders;
begin
  if _receiver_id is null or not exists (select 1 from public.business_receivers where id=_receiver_id and merchant_id=_mid and is_active) then
    raise exception 'Receiver not found or inactive'; end if;
  if _pp is null then
    select id into _pp from public.business_pickup_points where merchant_id=_mid and is_default and is_active limit 1;
    if _pp is null then raise exception 'No default pickup point'; end if;
  elsif not exists (select 1 from public.business_pickup_points where id=_pp and merchant_id=_mid and is_active) then
    raise exception 'Pickup point not found or inactive'; end if;
  if coalesce(_packet_count,1) not between 1 and 50 then raise exception 'Packet count must be between 1 and 50'; end if;
  if _ref is not null and exists (select 1 from public.business_orders where merchant_id=_mid and receiver_id=_receiver_id
       and status='pending' and lower(btrim(reference_no))=lower(_ref)) then
    raise exception 'A pending order with this invoice number already exists for this receiver'; end if;
  insert into public.business_orders(merchant_id,receiver_id,pickup_point_id,reference_no,description,packet_count,created_by_label)
  values (_mid,_receiver_id,_pp,_ref,nullif(btrim(coalesce(_description,'')),''),coalesce(_packet_count,1),_actor_label) returning * into _new;
  perform public.business_audit('business_create_order','business_orders',_new.id,null,to_jsonb(_new),_actor_label);
  return _new.id;
end $$;
revoke all on function public.business_order_insert(uuid,uuid,uuid,text,text,int,text) from public, anon, authenticated;

create or replace function public.business_create_order(_receiver_id uuid, _pickup_point_id uuid default null, _reference_no text default null,
  _description text default null, _packet_count int default 1, _actor_label text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare _mid uuid := public.business_require_delivery();
begin
  return public.business_order_insert(_mid,_receiver_id,_pickup_point_id,_reference_no,_description,_packet_count,_actor_label);
end $$;

create or replace function public.business_create_orders_bulk(_orders jsonb, _actor_label text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare _mid uuid := public.business_require_delivery(); _r jsonb; _i int := 0; _ids uuid[] := '{}'; _errs jsonb := '[]'; _id uuid;
begin
  if jsonb_typeof(_orders) <> 'array' or jsonb_array_length(_orders)=0 then raise exception 'Orders list is empty'; end if;
  if jsonb_array_length(_orders) > 500 then raise exception 'Too many orders at once (max 500)'; end if;
  begin
    for _r in select * from jsonb_array_elements(_orders) loop
      _i := _i + 1;
      begin
        _id := public.business_order_insert(_mid, nullif(_r->>'receiver_id','')::uuid, nullif(_r->>'pickup_point_id','')::uuid,
          _r->>'reference_no', _r->>'description', coalesce(nullif(_r->>'packet_count','')::int,1), _actor_label);
        _ids := array_append(_ids,_id);
      exception when others then
        _errs := _errs || jsonb_build_object('row',_i,'error',sqlerrm);
      end;
    end loop;
    if jsonb_array_length(_errs) > 0 then raise exception 'bulk_rollback'; end if;
  exception when others then
    if sqlerrm <> 'bulk_rollback' then _errs := _errs || jsonb_build_object('row',_i,'error',sqlerrm); end if;
    return jsonb_build_object('ok',false,'created_ids','[]'::jsonb,'errors',_errs);
  end;
  return jsonb_build_object('ok',true,'created_ids',to_jsonb(_ids),'errors','[]'::jsonb);
end $$;

create or replace function public.business_cancel_order(_order_id uuid, _reason text default null, _actor_label text default null)
returns void language plpgsql security definer set search_path=public as $$
declare _mid uuid := public.business_require_delivery(); _old jsonb; _new public.business_orders;
begin
  select to_jsonb(o) into _old from public.business_orders o where id=_order_id and merchant_id=_mid for update;
  if _old is null then raise exception 'Order not found'; end if;
  if _old->>'status' <> 'pending' then raise exception 'Only pending orders can be cancelled'; end if;
  update public.business_orders set status='cancelled', cancelled_at=now(), cancel_reason=nullif(btrim(coalesce(_reason,'')),'')
   where id=_order_id returning * into _new;
  perform public.business_audit('business_cancel_order','business_orders',_order_id,_old,to_jsonb(_new),_actor_label);
end $$;

-- grants
revoke all on function public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean) from public, anon;
revoke all on function public.staff_upsert_dispatch_plan(uuid,text,boolean,boolean,int,boolean,time[],int,boolean) from public, anon;
revoke all on function public.staff_set_plan_active(text,uuid,boolean,text) from public, anon;
revoke all on function public.staff_assign_business_plans(uuid,uuid,uuid) from public, anon;
revoke all on function public.staff_list_bulk_plans() from public, anon;
revoke all on function public.business_get_profile() from public, anon;
revoke all on function public.business_create_order(uuid,uuid,text,text,int,text) from public, anon;
revoke all on function public.business_create_orders_bulk(jsonb,text) from public, anon;
revoke all on function public.business_cancel_order(uuid,text,text) from public, anon;
grant execute on function public.staff_upsert_pricing_plan(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,boolean) to authenticated, service_role;
grant execute on function public.staff_upsert_dispatch_plan(uuid,text,boolean,boolean,int,boolean,time[],int,boolean) to authenticated, service_role;
grant execute on function public.staff_set_plan_active(text,uuid,boolean,text) to authenticated, service_role;
grant execute on function public.staff_assign_business_plans(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function public.staff_list_bulk_plans() to authenticated, service_role;
grant execute on function public.business_get_profile() to authenticated, service_role;
grant execute on function public.business_create_order(uuid,uuid,text,text,int,text) to authenticated, service_role;
grant execute on function public.business_create_orders_bulk(jsonb,text) to authenticated, service_role;
grant execute on function public.business_cancel_order(uuid,text,text) to authenticated, service_role;
grant execute on function public.business_order_insert(uuid,uuid,uuid,text,text,int,text) to service_role;