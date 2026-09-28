-- ===== 1. Settings & columns =====
alter table public.business_profiles
  add column if not exists drop_proof_mode text not null default 'otp',
  add column if not exists proof_retention_days int not null default 180;
alter table public.business_profiles drop constraint if exists business_profiles_drop_proof_mode_check;
alter table public.business_profiles add constraint business_profiles_drop_proof_mode_check
  check (drop_proof_mode in ('otp','bill_photo','otp_or_photo'));
alter table public.business_profiles drop constraint if exists business_profiles_proof_retention_check;
alter table public.business_profiles add constraint business_profiles_proof_retention_check
  check (proof_retention_days between 1 and 3650);

alter table public.courier_order_stops add column if not exists completed_via text;
alter table public.courier_order_stops drop constraint if exists courier_order_stops_completed_via_check;
alter table public.courier_order_stops add constraint courier_order_stops_completed_via_check
  check (completed_via is null or completed_via in ('otp','photo'));

alter table public.business_receivers
  add column if not exists verified_lat numeric,
  add column if not exists verified_lng numeric,
  add column if not exists verified_at timestamptz;

insert into public.ops_settings(key, value, label, updated_at)
values ('proof_geofence_m','150','Drop proof geofence (meters)', now())
on conflict (key) do nothing;

-- ===== 2. Proof table =====
create table if not exists public.business_delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  courier_order_id uuid not null references public.courier_orders(id) on delete cascade,
  stop_id uuid not null references public.courier_order_stops(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  receiver_id uuid references public.business_receivers(id) on delete set null,
  expert_id uuid,
  storage_path text not null unique,
  seal_codes text[] not null default '{}',
  lat numeric, lng numeric, accuracy_m numeric,
  distance_from_pin_m numeric,
  location_unverified boolean not null default false,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists business_delivery_proofs_stop_idx on public.business_delivery_proofs(stop_id);
create index if not exists business_delivery_proofs_merchant_idx on public.business_delivery_proofs(merchant_id, created_at);
grant select on public.business_delivery_proofs to authenticated;
grant all on public.business_delivery_proofs to service_role;
alter table public.business_delivery_proofs enable row level security;
drop policy if exists "proofs read" on public.business_delivery_proofs;
create policy "proofs read" on public.business_delivery_proofs for select to authenticated
using (merchant_id = public.current_merchant_id()
       or public.courier_is_ops_staff()
       or expert_id = public.get_expert_id_for_auth(auth.uid()));

-- ===== 3. Helpers =====
create or replace function public.business_haversine_m(_lat1 numeric, _lng1 numeric, _lat2 numeric, _lng2 numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select round((2 * 6371000 * asin(sqrt(
    power(sin(radians((_lat2-_lat1)::float8)/2),2) +
    cos(radians(_lat1::float8))*cos(radians(_lat2::float8))*power(sin(radians((_lng2-_lng1)::float8)/2),2))))::numeric, 1)
$$;

-- drop proof mode for a stop's order ('otp' for non-business orders)
create or replace function public.business_stop_proof_mode(_stop_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select bp.drop_proof_mode
      from public.courier_order_stops s
      join public.courier_orders o on o.id = s.order_id and o.source = 'business'
      join public.business_batches b on b.courier_order_id = o.id
      join public.business_profiles bp on bp.merchant_id = b.merchant_id
     where s.id = _stop_id limit 1), 'otp')
$$;

-- Shared drop-success path (used by OTP verify and photo proof)
create or replace function public.courier_complete_drop_internal(_order_id uuid, _stop_id uuid, _eid uuid, _via text, _proof_url text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype; _ndrops int; _pos int; _body text; _h jsonb;
begin
  select * into _o from public.courier_orders where id=_order_id;
  select * into _st from public.courier_order_stops where id=_stop_id;
  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);
  update public.courier_stop_secrets set verified_at=now(), updated_at=now() where stop_id=_stop_id;
  update public.courier_order_stops set status='completed', completed_at=now(), completed_via=_via, updated_at=now() where id=_stop_id;
  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_o.id, _o.status, _o.status, 'rider', _eid,
          jsonb_build_object('event', case when _via='photo' then 'stop_photo_verified' else 'stop_otp_verified' end,
                             'stop_id',_stop_id,'stop_type',_st.stop_type,'completed_via',_via));
  update public.courier_order_parcels set status='delivered', updated_at=now() where drop_stop_id=_stop_id and status='picked';
  update public.courier_orders set proof_photo_url = coalesce(_proof_url, proof_photo_url) where id=_o.id;
  select count(*) into _ndrops from public.courier_order_stops where order_id=_o.id and stop_type='drop';
  select count(*) into _pos from public.courier_order_stops where order_id=_o.id and stop_type='drop' and sequence <= _st.sequence;
  _body := case when _ndrops > 1 then format('Delivered at drop %s of %s.', _pos, _ndrops)
                else 'Your parcel has been delivered successfully.' end;
  perform public.notify_customer_user_push(_o.customer_id, 'Parcel delivered', _body, 'home');
  _h := public.courier_recompute_order_progress(_o.id);
  return jsonb_build_object('ok', true, 'issued_stop_ids', _h->'issued_stop_ids', 'order_status', _h->>'order_status');
end $$;

-- ===== 4. OTP verify (from live definition; drop success now via shared path; mode gate) =====
CREATE OR REPLACE FUNCTION public.courier_verify_stop_otp(_stop_id uuid, _otp text, _proof_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype; _s public.courier_stop_secrets%rowtype;
        _attempts int; _pending numeric; _h jsonb; _unscanned int;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  if _st.status = 'completed' then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_COMPLETED', 'completed_via', _st.completed_via);
  end if;
  if _st.status <> 'arrived' then raise exception 'Mark arrived at this stop first'; end if;
  if _st.stop_type in ('drop','return') and _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;

  if _o.source = 'business' and _st.stop_type = 'drop' and public.business_stop_proof_mode(_stop_id) = 'bill_photo' then
    return jsonb_build_object('ok', false, 'reason', 'PHOTO_REQUIRED');
  end if;

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

  if _st.stop_type = 'drop' then
    return public.courier_complete_drop_internal(_o.id, _stop_id, _eid, 'otp', _proof_url);
  end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  update public.courier_stop_secrets set verified_at=now(), updated_at=now() where stop_id=_stop_id;
  update public.courier_order_stops set status='completed', completed_at=now(), completed_via='otp', updated_at=now() where id=_stop_id;
  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_o.id, _o.status, _o.status, 'rider', _eid,
          jsonb_build_object('event','stop_otp_verified','stop_id',_stop_id,'stop_type',_st.stop_type));

  if _st.stop_type = 'pickup' then
    update public.courier_order_parcels set status='picked', updated_at=now() where pickup_stop_id=_stop_id and status='pending';
    if _o.status = 'ARRIVED_PICKUP' then
      update public.courier_orders set status='PICKED_UP', picked_up_at=now() where id=_o.id;
    end if;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel picked up', 'Your parcel has been picked up.', 'home');
  else
    update public.courier_order_parcels set status='returned', updated_at=now() where return_stop_id=_stop_id and status='returning';
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel returned', 'Your parcel has been returned to the pickup point.', 'home');
  end if;

  _h := public.courier_recompute_order_progress(_o.id);
  return jsonb_build_object('ok', true, 'issued_stop_ids', _h->'issued_stop_ids', 'order_status', _h->>'order_status');
end $function$;

-- ===== 5. Upload eligibility (server route only) =====
create or replace function public.business_proof_upload_check(_stop_id uuid, _uid uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'storage' as $$
declare _eid uuid; _st public.courier_order_stops%rowtype; _o public.courier_orders%rowtype; _mid uuid; _mode text;
        _unscanned int; _n int; _prefix text;
begin
  _eid := public.get_expert_id_for_auth(_uid);
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then return jsonb_build_object('ok',false,'reason','STOP_NOT_FOUND'); end if;
  select * into _o from public.courier_orders where id=_st.order_id;
  if _eid is null or _o.assigned_expert_id is distinct from _eid then return jsonb_build_object('ok',false,'reason','FORBIDDEN'); end if;
  if _o.source <> 'business' then return jsonb_build_object('ok',false,'reason','NOT_BUSINESS_TRIP'); end if;
  select merchant_id into _mid from public.business_batches where courier_order_id=_o.id limit 1;
  _mode := public.business_stop_proof_mode(_stop_id);
  if _mode = 'otp' then return jsonb_build_object('ok',false,'reason','MODE_OTP'); end if;
  if _st.stop_type <> 'drop' or _st.status not in ('pending','arrived') or _o.status <> 'IN_TRANSIT' then
    return jsonb_build_object('ok',false,'reason','STOP_NOT_ACTIVE'); end if;
  if _st.scan_skipped_at is null then
    select count(*) into _unscanned from public.business_trip_packets where drop_stop_id=_stop_id and scanned_drop_at is null;
    if _unscanned > 0 then return jsonb_build_object('ok',false,'reason','packets_not_scanned','unscanned',_unscanned); end if;
  end if;
  select count(*) into _n from storage.objects
   where bucket_id='delivery-proofs' and name like _mid::text || '/%/' || _stop_id::text || '/%';
  if _n >= 5 then return jsonb_build_object('ok',false,'reason','MAX_PHOTOS'); end if;
  _prefix := _mid::text || '/' || to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD') || '/' || _stop_id::text;
  return jsonb_build_object('ok',true,'path', _prefix || '/' || (_n+1) || '-' || substr(md5(random()::text),1,6) || '.jpg','count',_n);
end $$;

-- ===== 6. Complete drop with photo proof =====
create or replace function public.courier_complete_drop_with_proof(_stop_id uuid, _paths text[], _lat numeric, _lng numeric, _accuracy_m numeric, _captured_at timestamptz)
returns jsonb language plpgsql security definer set search_path to 'public', 'storage' as $$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype; _mid uuid; _mode text;
        _unscanned int; _p text; _rid uuid; _r public.business_receivers%rowtype; _fence numeric; _dist numeric;
        _unverified boolean := false; _tlat numeric; _tlng numeric; _codes text[]; _res jsonb;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  if _o.source <> 'business' or _st.stop_type <> 'drop' then return jsonb_build_object('ok',false,'reason','NOT_BUSINESS_DROP'); end if;
  if _st.status = 'completed' then return jsonb_build_object('ok',false,'reason','ALREADY_COMPLETED','completed_via',_st.completed_via); end if;
  _mode := public.business_stop_proof_mode(_stop_id);
  if _mode = 'otp' then return jsonb_build_object('ok',false,'reason','MODE_OTP'); end if;
  if _st.status <> 'arrived' then raise exception 'Mark arrived at this stop first'; end if;
  if _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;
  if _lat is null or _lng is null then return jsonb_build_object('ok',false,'reason','LOCATION_REQUIRED'); end if;

  if _st.scan_skipped_at is null then
    select count(*) into _unscanned from public.business_trip_packets where drop_stop_id=_stop_id and scanned_drop_at is null;
    if _unscanned > 0 then return jsonb_build_object('ok',false,'reason','packets_not_scanned','unscanned',_unscanned); end if;
  end if;

  select merchant_id into _mid from public.business_batches where courier_order_id=_o.id limit 1;
  if coalesce(array_length(_paths,1),0) < 1 or array_length(_paths,1) > 5 then
    return jsonb_build_object('ok',false,'reason','PHOTO_COUNT'); end if;
  foreach _p in array _paths loop
    if _p not like _mid::text || '/%/' || _stop_id::text || '/%'
       or not exists (select 1 from storage.objects where bucket_id='delivery-proofs' and name=_p) then
      return jsonb_build_object('ok',false,'reason','PHOTO_NOT_FOUND','path',_p);
    end if;
  end loop;

  select receiver_id into _rid from public.business_orders where drop_stop_id=_stop_id and receiver_id is not null limit 1;
  select * into _r from public.business_receivers where id=_rid for update;
  _fence := coalesce(nullif((select value from public.ops_settings where key='proof_geofence_m'),'')::numeric, 150);
  if _r.verified_lat is not null and _r.verified_lng is not null then
    _tlat := _r.verified_lat; _tlng := _r.verified_lng;
  else
    _tlat := coalesce(_r.lat, _st.lat); _tlng := coalesce(_r.lng, _st.lng);
    _unverified := true;
  end if;
  _dist := case when _tlat is null then null else public.business_haversine_m(_lat,_lng,_tlat,_tlng) end;
  if not _unverified and _dist > _fence then
    return jsonb_build_object('ok',false,'reason','OUTSIDE_GEOFENCE','distance_m',_dist,'limit_m',_fence);
  end if;
  if _unverified and _r.id is not null then
    update public.business_receivers set verified_lat=_lat, verified_lng=_lng, verified_at=now(), updated_at=now() where id=_r.id;
  end if;

  select coalesce(array_agg(code order by packet_no),'{}') into _codes from public.business_trip_packets where drop_stop_id=_stop_id;
  insert into public.business_delivery_proofs(courier_order_id, stop_id, merchant_id, receiver_id, expert_id, storage_path,
     seal_codes, lat, lng, accuracy_m, distance_from_pin_m, location_unverified, captured_at)
  select _o.id, _stop_id, _mid, _r.id, _eid, p, _codes, _lat, _lng, _accuracy_m, _dist, _unverified, coalesce(_captured_at, now())
    from unnest(_paths) p;

  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_o.id, _o.status, _o.status, 'rider', _eid,
          jsonb_build_object('event','drop_proof_submitted','stop_id',_stop_id,'photos',array_length(_paths,1),
                             'distance_m',_dist,'location_unverified',_unverified));
  perform public.business_audit('courier_complete_drop_with_proof','courier_order_stops',_stop_id,null,
     jsonb_build_object('paths',_paths,'distance_m',_dist,'location_unverified',_unverified,'merchant_id',_mid),'rider');

  _res := public.courier_complete_drop_internal(_o.id, _stop_id, _eid, 'photo', null);
  return _res || jsonb_build_object('location_unverified',_unverified,'distance_m',_dist);
end $$;

-- ===== 7. Rider trip data (from live definition, adds proof info) =====
CREATE OR REPLACE FUNCTION public.courier_trip_packets(_courier_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _eid uuid; _o public.courier_orders%rowtype; _mode text;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _eid is null or _o.id is null or _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select bp.drop_proof_mode into _mode from public.business_batches b join public.business_profiles bp on bp.merchant_id=b.merchant_id
   where b.courier_order_id=_o.id limit 1;
  _mode := coalesce(_mode,'otp');
  return jsonb_build_object('order_id', _o.id,
    'trip_no', (select trip_no from public.business_batches where courier_order_id=_o.id limit 1),
    'drop_proof_mode', _mode,
    'packets', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'drop_stop_id',p.drop_stop_id,
        'drop_label',p.drop_label,'packet_no',p.packet_no,'packet_total',p.packet_total,
        'scanned_pickup_at',p.scanned_pickup_at,'scanned_drop_at',p.scanned_drop_at,
        'pickup_entry_method',p.pickup_entry_method,'drop_entry_method',p.drop_entry_method,
        'is_seal', p.code ~ '^[0-9]{7}$',
        'printed_code', case when p.code ~ '^[0-9]{7}$' then left(p.code,6)||'-'||right(p.code,1) else p.code end)
        order by s.sequence, p.packet_no)
      from public.business_trip_packets p join public.courier_order_stops s on s.id=p.drop_stop_id
      where p.courier_order_id=_o.id),'[]'::jsonb),
    'drop_stops', coalesce((select jsonb_agg(jsonb_build_object('stop_id',s.id,'sequence',s.sequence,'status',s.status,
        'drop_proof_mode',_mode,'completed_via',s.completed_via,
        'proofs', coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'storage_path',d.storage_path,'captured_at',d.captured_at,
                   'location_unverified',d.location_unverified) order by d.created_at)
                 from public.business_delivery_proofs d where d.stop_id=s.id),'[]'::jsonb)) order by s.sequence)
      from public.courier_order_stops s where s.order_id=_o.id and s.stop_type='drop'),'[]'::jsonb),
    'removed_packets', coalesce((select jsonb_agg(jsonb_build_object('code',rp.code,'drop_label',rp.drop_label,
        'receiver_name',(select r.name from public.business_receivers r where r.id=rp.receiver_id),
        'reason',rp.reason_code,'notes',rp.notes,'removed_by',rp.removed_by,'removed_at',rp.removed_at) order by rp.removed_at)
      from public.business_trip_removed_packets rp where rp.courier_order_id=_o.id),'[]'::jsonb));
end $function$;

-- ===== 8. Staff settings =====
create or replace function public.staff_set_business_proof_settings(_merchant_id uuid, _drop_proof_mode text, _proof_retention_days int, _reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _before jsonb; _after jsonb;
begin
  perform public.business_require_ops();
  if _drop_proof_mode not in ('otp','bill_photo','otp_or_photo') then raise exception 'Invalid drop proof mode'; end if;
  if _proof_retention_days is null or _proof_retention_days < 1 or _proof_retention_days > 3650 then raise exception 'Retention must be 1-3650 days'; end if;
  select jsonb_build_object('drop_proof_mode',drop_proof_mode,'proof_retention_days',proof_retention_days) into _before
    from public.business_profiles where merchant_id=_merchant_id for update;
  if _before is null then raise exception 'Business profile not found'; end if;
  update public.business_profiles set drop_proof_mode=_drop_proof_mode, proof_retention_days=_proof_retention_days, updated_at=now()
   where merchant_id=_merchant_id;
  _after := jsonb_build_object('drop_proof_mode',_drop_proof_mode,'proof_retention_days',_proof_retention_days,'reason',_reason);
  perform public.business_audit('staff_set_business_proof_settings','business_profiles',_merchant_id,_before,_after,'staff');
  return jsonb_build_object('ok',true) || _after;
end $$;

-- ===== 9. Read RPCs =====
create or replace function public.business_proof_can_read(_merchant_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select _merchant_id = public.current_merchant_id() or public.courier_is_ops_staff()
$$;

create or replace function public.business_stop_proofs(_stop_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _mid uuid; _st public.courier_order_stops%rowtype;
begin
  select * into _st from public.courier_order_stops where id=_stop_id;
  select b.merchant_id into _mid from public.business_batches b where b.courier_order_id=_st.order_id limit 1;
  if _mid is null or not public.business_proof_can_read(_mid) then raise exception 'Forbidden' using errcode='42501'; end if;
  return jsonb_build_object('stop_id',_stop_id,'status',_st.status,'completed_via',_st.completed_via,'completed_at',_st.completed_at,
    'proofs', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.business_delivery_proofs d where d.stop_id=_stop_id),'[]'::jsonb));
end $$;

create or replace function public.business_order_proofs(_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _bo public.business_orders%rowtype;
begin
  select * into _bo from public.business_orders where id=_order_id;
  if _bo.id is null or not public.business_proof_can_read(_bo.merchant_id) then raise exception 'Forbidden' using errcode='42501'; end if;
  if _bo.drop_stop_id is null then return jsonb_build_object('order_id',_order_id,'completed_via',null,'proofs','[]'::jsonb); end if;
  return jsonb_build_object('order_id',_order_id) || public.business_stop_proofs(_bo.drop_stop_id);
end $$;

create or replace function public.business_proof_report(_merchant_id uuid, _from date, _to date, _receiver_id uuid default null, _limit int default 50, _offset int default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _rows jsonb; _total int;
begin
  if not public.business_proof_can_read(_merchant_id) then raise exception 'Forbidden' using errcode='42501'; end if;
  _limit := least(greatest(coalesce(_limit,50),1),500);
  with st as (
    select distinct on (s.id) s.id stop_id, s.completed_at, s.completed_via, o.id courier_order_id, o.assigned_expert_id,
           bo.receiver_id
      from public.courier_order_stops s
      join public.courier_orders o on o.id=s.order_id
      join public.business_batches b on b.courier_order_id=o.id and b.merchant_id=_merchant_id
      left join public.business_orders bo on bo.drop_stop_id=s.id
     where s.stop_type='drop' and s.status='completed'
       and (s.completed_at at time zone 'Asia/Kolkata')::date between _from and _to
       and (_receiver_id is null or bo.receiver_id=_receiver_id)
  )
  select count(*) over ()::int, x into _total, _rows from (select 1) z,
  lateral (select coalesce(jsonb_agg(r order by (r->>'completed_at') desc),'[]'::jsonb) x from (
    select jsonb_build_object('stop_id',st.stop_id,'courier_order_id',st.courier_order_id,'completed_at',st.completed_at,
      'completed_via',st.completed_via,'receiver_id',st.receiver_id,
      'receiver_name',(select name from public.business_receivers where id=st.receiver_id),
      'rider_name',(select e.name from public.experts e where e.id=st.assigned_expert_id),
      'seal_codes',(select coalesce(array_agg(bo2.seal_code) filter (where bo2.seal_code is not null),'{}') from public.business_orders bo2 where bo2.drop_stop_id=st.stop_id),
      'photo_paths',(select coalesce(array_agg(d.storage_path order by d.created_at),'{}') from public.business_delivery_proofs d where d.stop_id=st.stop_id),
      'location_unverified',(select coalesce(bool_or(d.location_unverified),false) from public.business_delivery_proofs d where d.stop_id=st.stop_id)) r
    from st order by st.completed_at desc limit _limit offset greatest(coalesce(_offset,0),0)) q) l;
  select count(*) into _total from (
    select distinct s.id from public.courier_order_stops s
      join public.business_batches b on b.courier_order_id=s.order_id and b.merchant_id=_merchant_id
      left join public.business_orders bo on bo.drop_stop_id=s.id
     where s.stop_type='drop' and s.status='completed'
       and (s.completed_at at time zone 'Asia/Kolkata')::date between _from and _to
       and (_receiver_id is null or bo.receiver_id=_receiver_id)) t;
  return jsonb_build_object('total',_total,'limit',_limit,'offset',greatest(coalesce(_offset,0),0),'rows',_rows);
end $$;

-- paths the caller may download (for signed URLs)
create or replace function public.business_proof_readable_paths(_paths text[])
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(d.storage_path),'{}') from public.business_delivery_proofs d
   where d.storage_path = any(_paths)
     and (public.business_proof_can_read(d.merchant_id) or d.expert_id = public.get_expert_id_for_auth(auth.uid()))
$$;

-- ===== 10. Retention =====
create or replace function public.business_proof_expired(_limit int default 500)
returns table(id uuid, storage_path text) language sql stable security definer set search_path to 'public' as $$
  select d.id, d.storage_path from public.business_delivery_proofs d
    join public.business_profiles bp on bp.merchant_id=d.merchant_id
   where d.created_at < now() - make_interval(days => bp.proof_retention_days)
   order by d.created_at limit greatest(1, least(coalesce(_limit,500),1000))
$$;
create or replace function public.business_proof_purge(_ids uuid[])
returns int language plpgsql security definer set search_path to 'public' as $$
declare _n int; begin delete from public.business_delivery_proofs where id = any(_ids); get diagnostics _n = row_count; return _n; end $$;

create or replace function public.business_proof_cleanup_wake()
returns void language plpgsql security definer set search_path to 'public', 'vault' as $$
declare _secret text;
begin
  select decrypted_secret into _secret from vault.decrypted_secrets where name='courier_job_secret';
  if _secret is null then raise warning 'courier_job_secret missing'; return; end if;
  perform net.http_post(url := 'https://user.badiyos.com/api/public/proof/cleanup',
    headers := jsonb_build_object('Content-Type','application/json','x-courier-job-secret', _secret), body := '{}'::jsonb);
exception when others then raise warning 'business_proof_cleanup_wake failed: %', sqlerrm;
end $$;

-- ===== 11. Access =====
revoke all on function public.business_haversine_m(numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.business_haversine_m(numeric,numeric,numeric,numeric) to authenticated, service_role;
do $g$ declare f text; begin
  foreach f in array array[
    'public.business_stop_proof_mode(uuid)','public.courier_complete_drop_internal(uuid,uuid,uuid,text,text)',
    'public.business_proof_upload_check(uuid,uuid)','public.business_proof_expired(integer)',
    'public.business_proof_purge(uuid[])','public.business_proof_cleanup_wake()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.courier_complete_drop_with_proof(uuid,text[],numeric,numeric,numeric,timestamptz)',
    'public.staff_set_business_proof_settings(uuid,text,integer,text)','public.business_proof_can_read(uuid)',
    'public.business_stop_proofs(uuid)','public.business_order_proofs(uuid)',
    'public.business_proof_report(uuid,date,date,uuid,integer,integer)','public.business_proof_readable_paths(text[])',
    'public.courier_verify_stop_otp(uuid,text,text)','public.courier_trip_packets(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $g$;

-- daily cleanup at 03:00 IST
select cron.unschedule('delivery-proof-retention') where exists (select 1 from cron.job where jobname='delivery-proof-retention');
select cron.schedule('delivery-proof-retention', '30 21 * * *', $$select public.business_proof_cleanup_wake();$$);