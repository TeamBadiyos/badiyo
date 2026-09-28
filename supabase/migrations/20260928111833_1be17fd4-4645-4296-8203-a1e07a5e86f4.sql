insert into public.ops_settings(key, value, label, updated_at)
values ('proof_first_delivery_radius_m','1000','First delivery radius from receiver pin (meters)', now())
on conflict (key) do nothing;

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
  if _r.verified_lat is not null and _r.verified_lng is not null then
    _tlat := _r.verified_lat; _tlng := _r.verified_lng;
    _fence := coalesce(nullif((select value from public.ops_settings where key='proof_geofence_m'),'')::numeric, 150);
  else
    _tlat := coalesce(_r.lat, _st.lat); _tlng := coalesce(_r.lng, _st.lng);
    _fence := coalesce(nullif((select value from public.ops_settings where key='proof_first_delivery_radius_m'),'')::numeric, 1000);
    _unverified := true;
  end if;
  if _tlat is null or _tlng is null then return jsonb_build_object('ok',false,'reason','NO_RECEIVER_LOCATION'); end if;
  _dist := public.business_haversine_m(_lat,_lng,_tlat,_tlng);
  if _dist > _fence then
    return jsonb_build_object('ok',false,'reason','OUTSIDE_GEOFENCE','distance_m',_dist,'limit_m',_fence,'first_delivery',_unverified);
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

create or replace function public.staff_reset_receiver_location(_receiver_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _before jsonb;
begin
  perform public.business_require_ops();
  if coalesce(btrim(_reason),'') = '' then raise exception 'Reason is required'; end if;
  select jsonb_build_object('verified_lat',verified_lat,'verified_lng',verified_lng,'verified_at',verified_at) into _before
    from public.business_receivers where id=_receiver_id for update;
  if _before is null then raise exception 'Receiver not found'; end if;
  update public.business_receivers set verified_lat=null, verified_lng=null, verified_at=null, updated_at=now() where id=_receiver_id;
  perform public.business_audit('staff_reset_receiver_location','business_receivers',_receiver_id,_before,
    jsonb_build_object('verified_lat',null,'verified_lng',null,'verified_at',null,'reason',_reason),'staff');
  return jsonb_build_object('ok',true,'receiver_id',_receiver_id);
end $$;

revoke all on function public.courier_complete_drop_with_proof(uuid,text[],numeric,numeric,numeric,timestamptz) from public, anon;
grant execute on function public.courier_complete_drop_with_proof(uuid,text[],numeric,numeric,numeric,timestamptz) to authenticated, service_role;
revoke all on function public.staff_reset_receiver_location(uuid,text) from public, anon;
grant execute on function public.staff_reset_receiver_location(uuid,text) to authenticated, service_role;