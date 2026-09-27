-- 1. Daily trip counter
create table public.business_trip_counters (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  day date not null,
  last_no int not null default 0,
  updated_at timestamptz not null default now()
);
grant all on public.business_trip_counters to service_role;
alter table public.business_trip_counters enable row level security;

create or replace function public.business_next_trip_no(_merchant_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare _today date := (now() at time zone 'Asia/Kolkata')::date; _c public.business_trip_counters%rowtype;
begin
  insert into public.business_trip_counters(merchant_id, day, last_no) values (_merchant_id, _today, 0)
  on conflict (merchant_id) do nothing;
  select * into _c from public.business_trip_counters where merchant_id=_merchant_id for update;
  if _c.day <> _today then
    update public.business_trip_counters set day=_today, last_no=1, updated_at=now() where merchant_id=_merchant_id;
    return 1;
  end if;
  update public.business_trip_counters set last_no=last_no+1, updated_at=now() where merchant_id=_merchant_id;
  return _c.last_no + 1;
end $$;
revoke all on function public.business_next_trip_no(uuid) from public, anon, authenticated;

create or replace function public.business_batches_daily_trip_no()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _old int := new.trip_no;
begin
  new.trip_no := public.business_next_trip_no(new.merchant_id);
  if new.trip_label is null or (_old is not null and new.trip_label = 'Trip ' || _old) then
    new.trip_label := 'Trip ' || new.trip_no;
  end if;
  return new;
end $$;
revoke all on function public.business_batches_daily_trip_no() from public, anon, authenticated;
create trigger trg_business_batches_daily_trip_no before insert on public.business_batches
  for each row execute function public.business_batches_daily_trip_no();

-- 2. Packets
alter table public.courier_order_stops
  add column if not exists scan_skipped_at timestamptz,
  add column if not exists scan_skipped_by uuid,
  add column if not exists scan_skip_reason text;

create table public.business_trip_packets (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.business_batches(id) on delete cascade,
  courier_order_id uuid not null references public.courier_orders(id) on delete cascade,
  drop_stop_id uuid not null references public.courier_order_stops(id) on delete cascade,
  drop_label text not null,
  packet_no int not null,
  packet_total int not null,
  code text not null unique,
  scanned_pickup_at timestamptz,
  scanned_drop_at timestamptz,
  created_at timestamptz not null default now()
);
create index business_trip_packets_order_idx on public.business_trip_packets(courier_order_id);
create index business_trip_packets_stop_idx on public.business_trip_packets(drop_stop_id);
grant select on public.business_trip_packets to authenticated;
grant all on public.business_trip_packets to service_role;
alter table public.business_trip_packets enable row level security;
create policy "Owning business and ops read packets" on public.business_trip_packets for select to authenticated
using (
  public.courier_is_ops_staff()
  or exists (select 1 from public.business_batches b join public.merchants m on m.id=b.merchant_id
              where b.id=batch_id and m.auth_user_id=auth.uid())
  or exists (select 1 from public.business_batches b join public.merchant_staff s on s.merchant_id=b.merchant_id
              where b.id=batch_id and s.auth_user_id=auth.uid() and s.status='active')
);

create or replace function public.business_create_trip_packets(_batch_id uuid, _cid uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare _b public.business_batches%rowtype; _d record; _i int; _code text; _n int := 0; _label text;
begin
  select * into _b from public.business_batches where id=_batch_id;
  if exists (select 1 from public.business_trip_packets where batch_id=_batch_id) then return 0; end if;
  for _d in
    select bo.drop_stop_id, bo.receiver_id, greatest(1, sum(coalesce(bo.packet_count,1)))::int total
      from public.business_orders bo
     where bo.batch_id=_batch_id and bo.courier_order_id=_cid and bo.drop_stop_id is not null
     group by bo.drop_stop_id, bo.receiver_id
  loop
    select dl.item->>'label' into _label from jsonb_array_elements(coalesce(_b.drop_labels,'[]'::jsonb)) dl(item)
     where (dl.item->>'receiver_id')::uuid = _d.receiver_id limit 1;
    _label := coalesce(_label, 'C?');
    for _i in 1.._d.total loop
      loop
        _code := format('T%s-%s-%s-%s', _b.trip_no, _label, _i,
                  upper(substr(translate(encode(gen_random_bytes(6),'base64'),'+/=0O1IL','XYZ'),1,4)));
        exit when not exists (select 1 from public.business_trip_packets where code=_code);
      end loop;
      insert into public.business_trip_packets(batch_id, courier_order_id, drop_stop_id, drop_label, packet_no, packet_total, code)
      values (_batch_id, _cid, _d.drop_stop_id, _label, _i, _d.total, _code);
      _n := _n + 1;
    end loop;
  end loop;
  return _n;
end $$;
revoke all on function public.business_create_trip_packets(uuid, uuid) from public, anon, authenticated;

-- courier_create_business_order: from live definition + packet creation
CREATE OR REPLACE FUNCTION public.courier_create_business_order(_batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[], _fare jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  perform public.business_create_trip_packets(_batch_id, _cid);
  return _cid;
end $function$;

-- 3. Rider actions
create or replace function public.courier_scan_packet(_courier_order_id uuid, _code text, _stage text, _stop_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype;
        _pk public.business_trip_packets%rowtype; _res text; _sc int; _tot int;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  if _stage not in ('pickup','drop') then raise exception 'Invalid stage'; end if;
  select * into _o from public.courier_orders where id=_courier_order_id for update;
  if _o.id is null or _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null or _st.order_id <> _o.id or _st.stop_type <> _stage then raise exception 'Invalid stop'; end if;

  select * into _pk from public.business_trip_packets where code=upper(btrim(coalesce(_code,''))) for update;
  if _pk.id is null then _res := 'unknown';
  elsif _pk.courier_order_id <> _o.id then _res := 'wrong_trip';
  elsif _stage='drop' and _pk.drop_stop_id <> _stop_id then _res := 'wrong_stop';
  elsif (_stage='pickup' and _pk.scanned_pickup_at is not null) or (_stage='drop' and _pk.scanned_drop_at is not null) then _res := 'already_scanned';
  else
    if _stage='pickup' then update public.business_trip_packets set scanned_pickup_at=now() where id=_pk.id;
    else update public.business_trip_packets set scanned_drop_at=now() where id=_pk.id; end if;
    _res := 'ok';
  end if;

  if _stage='pickup' then
    select count(*) filter (where scanned_pickup_at is not null), count(*) into _sc, _tot
      from public.business_trip_packets where courier_order_id=_o.id;
  else
    select count(*) filter (where scanned_drop_at is not null), count(*) into _sc, _tot
      from public.business_trip_packets where drop_stop_id=_stop_id;
  end if;
  return jsonb_build_object('result', _res, 'ok', _res='ok', 'scanned', _sc, 'total', _tot,
    'packet_no', case when _res in ('ok','already_scanned') then _pk.packet_no end,
    'drop_label', case when _res in ('ok','already_scanned','wrong_stop') then _pk.drop_label end);
end $$;
revoke all on function public.courier_scan_packet(uuid,text,text,uuid) from public, anon;
grant execute on function public.courier_scan_packet(uuid,text,text,uuid) to authenticated;

create or replace function public.courier_trip_packets(_courier_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _eid uuid; _o public.courier_orders%rowtype;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _eid is null or _o.id is null or _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  return jsonb_build_object('order_id', _o.id,
    'trip_no', (select trip_no from public.business_batches where courier_order_id=_o.id limit 1),
    'packets', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'drop_stop_id',p.drop_stop_id,
        'drop_label',p.drop_label,'packet_no',p.packet_no,'packet_total',p.packet_total,
        'scanned_pickup_at',p.scanned_pickup_at,'scanned_drop_at',p.scanned_drop_at)
        order by s.sequence, p.packet_no)
      from public.business_trip_packets p join public.courier_order_stops s on s.id=p.drop_stop_id
      where p.courier_order_id=_o.id),'[]'::jsonb));
end $$;
revoke all on function public.courier_trip_packets(uuid) from public, anon;
grant execute on function public.courier_trip_packets(uuid) to authenticated;

-- 4. Ops skip
create or replace function public.staff_courier_skip_scan(_stop_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _st public.courier_order_stops%rowtype;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  if _st.id is null then raise exception 'Stop not found'; end if;
  update public.courier_order_stops set scan_skipped_at=now(), scan_skipped_by=auth.uid(), scan_skip_reason=left(btrim(_reason),200) where id=_stop_id;
  perform public.business_audit('staff_courier_skip_scan','courier_order_stops',_stop_id,to_jsonb(_st),
    (select to_jsonb(x) from public.courier_order_stops x where id=_stop_id), btrim(_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.staff_courier_skip_scan(uuid,text) from public, anon;
grant execute on function public.staff_courier_skip_scan(uuid,text) to authenticated;

-- courier_verify_stop_otp: live definition + scan gate
CREATE OR REPLACE FUNCTION public.courier_verify_stop_otp(_stop_id uuid, _otp text, _proof_url text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype; _s public.courier_stop_secrets%rowtype;
        _attempts int; _ndrops int; _pos int; _body text; _pending numeric; _h jsonb; _unscanned int;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  if _st.status <> 'arrived' then raise exception 'Mark arrived at this stop first'; end if;
  if _st.stop_type in ('drop','return') and _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;

  if _o.source = 'business' and _st.scan_skipped_at is null then
    if _st.stop_type = 'pickup' then
      select count(*) into _unscanned from public.business_trip_packets where courier_order_id=_o.id and scanned_pickup_at is null;
    elsif _st.stop_type = 'drop' then
      select count(*) into _unscanned from public.business_trip_packets where drop_stop_id=_stop_id and scanned_drop_at is null;
    end if;
    if coalesce(_unscanned,0) > 0 then
      return jsonb_build_object('ok', false, 'reason', 'packets_not_scanned', 'unscanned', _unscanned);
    end if;
  end if;

  if _st.stop_type = 'return' then
    select sum(c.total_amount) into _pending from public.courier_order_charges c
     where c.status='pending' and c.parcel_id in (select id from public.courier_order_parcels where return_stop_id=_stop_id);
    if _pending is not null then
      return jsonb_build_object('ok', false, 'reason', 'payment_pending', 'amount', _pending);
    end if;
  end if;

  select * into _s from public.courier_stop_secrets where stop_id=_stop_id for update;
  if _s.locked_until is not null and _s.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if _s.otp_expires_at is null or _s.otp_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if not (_s.otp_hash is not null and _s.otp_hash = public.courier_hash_otp(coalesce(_otp,''))) then
    _attempts := coalesce(_s.attempts,0) + 1;
    update public.courier_stop_secrets set attempts=_attempts,
      locked_until = case when _attempts >= 5 then now() + interval '30 minutes' else locked_until end, updated_at=now()
     where stop_id=_stop_id;
    update public.courier_orders set otp_attempts = otp_attempts + 1,
           needs_ops_attention = (_attempts >= 5) or needs_ops_attention where id=_o.id;
    insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
    values (_o.id, _o.status, _o.status, 'rider', _eid,
            jsonb_build_object('event','stop_otp_wrong','stop_id',_stop_id,'attempts',_attempts));
    return jsonb_build_object('ok', false, 'reason', 'wrong_otp', 'attempts_left', greatest(0, 5 - _attempts));
  end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  update public.courier_stop_secrets set verified_at=now(), updated_at=now() where stop_id=_stop_id;
  update public.courier_order_stops set status='completed', completed_at=now(), updated_at=now() where id=_stop_id;
  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_o.id, _o.status, _o.status, 'rider', _eid,
          jsonb_build_object('event','stop_otp_verified','stop_id',_stop_id,'stop_type',_st.stop_type));

  if _st.stop_type = 'pickup' then
    update public.courier_order_parcels set status='picked', updated_at=now() where pickup_stop_id=_stop_id and status='pending';
    if _o.status = 'ARRIVED_PICKUP' then
      update public.courier_orders set status='PICKED_UP', picked_up_at=now() where id=_o.id;
    end if;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel picked up', 'Your parcel has been picked up.', 'home');
  elsif _st.stop_type = 'drop' then
    update public.courier_order_parcels set status='delivered', updated_at=now() where drop_stop_id=_stop_id and status='picked';
    update public.courier_orders set proof_photo_url = coalesce(_proof_url, proof_photo_url) where id=_o.id;
    select count(*) into _ndrops from public.courier_order_stops where order_id=_o.id and stop_type='drop';
    select count(*) into _pos from public.courier_order_stops where order_id=_o.id and stop_type='drop' and sequence <= _st.sequence;
    _body := case when _ndrops > 1 then format('Delivered at drop %s of %s.', _pos, _ndrops)
                  else 'Your parcel has been delivered successfully.' end;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel delivered', _body, 'home');
  else
    update public.courier_order_parcels set status='returned', updated_at=now() where return_stop_id=_stop_id and status='returning';
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel returned', 'Your parcel has been returned to the pickup point.', 'home');
  end if;

  _h := public.courier_recompute_order_progress(_o.id);
  return jsonb_build_object('ok', true, 'issued_stop_ids', _h->'issued_stop_ids', 'order_status', _h->>'order_status');
end $function$;

-- 5. Business code view: live definition + packets
CREATE OR REPLACE FUNCTION public.business_get_trip_otps(_courier_order_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _mid uuid := public.business_require_delivery(); _o public.courier_orders%rowtype; _b public.business_batches%rowtype; _rider_name text; _rider_phone text; _run_created_at timestamptz;
  _picked boolean; _can_cancel boolean; _fee numeric := 0; _amt numeric;
begin
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _o.id is null or _o.source is distinct from 'business' or _o.business_merchant_id is distinct from _mid then
    raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _b from public.business_batches where courier_order_id=_o.id limit 1;
  if _b.dispatch_run_id is not null then
    select created_at into _run_created_at from public.business_dispatch_runs where id=_b.dispatch_run_id;
  end if;
  if _o.assigned_expert_id is not null then
    select name, phone into _rider_name, _rider_phone from public.experts where id=_o.assigned_expert_id;
  end if;
  _amt := coalesce(_o.total_amount,0);
  _picked := exists (select 1 from public.courier_order_stops s where s.order_id=_o.id and s.stop_type='pickup' and s.completed_at is not null);
  _can_cancel := _b.id is not null and _b.status = 'dispatched' and not _picked
    and _o.status in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP');
  if _can_cancel and _o.status = 'ARRIVED_PICKUP' then
    _fee := (select f.fee_total from public.courier_cancel_fee_for(_o.id) f);
  end if;
  return jsonb_build_object('order_id',_o.id,'order_code',_o.order_code,'status',_o.status,
    'batch_id',_b.id,'trip_amount',_amt,'can_cancel',_can_cancel,
    'cancel_fee_preview',_fee,'refund_preview',round(greatest(0,_amt-_fee),2),
    'run_label',case when _run_created_at is null then null else to_char(_run_created_at at time zone 'Asia/Kolkata', 'HH24:MI') end,
    'trip_no',_b.trip_no,'trip_label',_b.trip_label,
    'parcel_count',coalesce((select sum(bo.packet_count) from public.business_orders bo where bo.batch_id=_b.id),0),
    'rider_available',_o.assigned_expert_id is not null,
    'rider_name',_rider_name,'rider_phone',_rider_phone,
    'stops', coalesce((select jsonb_agg(jsonb_build_object(
      'stop_id',s.id,'stop_type',s.stop_type,'sequence',s.sequence,'address',s.address,
      'drop_label',case when s.stop_type='drop' then (
        select dl.item->>'label'
          from jsonb_array_elements(coalesce(_b.drop_labels,'[]'::jsonb)) with ordinality dl(item, ordinal)
          where (dl.item->>'receiver_id')::uuid = (
            select bo.receiver_id from public.business_orders bo where bo.drop_stop_id=s.id limit 1)
          limit 1) else null end,
      'receiver_name', coalesce((select r.name from public.business_orders bo join public.business_receivers r on r.id=bo.receiver_id
                                  where bo.drop_stop_id=s.id limit 1), s.contact_name),
      'contact_name',s.contact_name,'contact_phone',s.contact_phone,'status',s.status,
      'reference_nos',(select jsonb_agg(bo.reference_no order by bo.created_at) from public.business_orders bo where bo.drop_stop_id=s.id and bo.reference_no is not null),
      'parcel_count',coalesce((select sum(bo.packet_count) from public.business_orders bo where bo.drop_stop_id=s.id),0),
      'packets', coalesce((select jsonb_agg(jsonb_build_object('code',p.code,'packet_no',p.packet_no,'packet_total',p.packet_total,
                  'trip_no',_b.trip_no,'drop_label',p.drop_label,'scanned_pickup_at',p.scanned_pickup_at,'scanned_drop_at',p.scanned_drop_at)
                  order by p.packet_no) from public.business_trip_packets p where p.drop_stop_id=s.id),'[]'::jsonb),
      'otp',public.courier_stop_visible_otp(s.id)) order by s.sequence)
      from public.courier_order_stops s where s.order_id=_o.id),'[]'::jsonb));
end $function$;