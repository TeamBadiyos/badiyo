create or replace function public.courier_my_phone10() returns text language plpgsql stable security definer set search_path=public as $$
declare _p text; _del timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select deleted_at into _del from public.users where id=auth.uid();
  if _del is not null then return null; end if;
  select nullif(regexp_replace(coalesce(phone,''),'\D','','g'),'') into _p from auth.users where id=auth.uid();
  if _p is null then select nullif(regexp_replace(coalesce(phone,''),'\D','','g'),'') into _p from public.users where id=auth.uid(); end if;
  if _p is null or length(_p)<10 then return null; end if;
  return right(_p,10);
end $$;

create or replace function public.courier_stop_visible_otp(_stop_id uuid) returns text language plpgsql stable security definer set search_path=public as $$
declare _st public.courier_order_stops%rowtype; _s public.courier_stop_secrets%rowtype;
begin
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null or _st.status in ('completed','failed','cancelled') then return null; end if;
  select * into _s from public.courier_stop_secrets where stop_id=_stop_id;
  if _s.otp_issued_at is null or _s.verified_at is not null or (_s.otp_expires_at is not null and _s.otp_expires_at<=now()) then return null; end if;
  return public.courier_derive_otp(_stop_id, public.courier_stop_purpose(_st.stop_type), _s.otp_issued_at);
end $$;

create or replace function public.courier_get_order_otps(_order_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare _o public.courier_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id;
  if _o.id is null or _o.customer_id<>auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('stop_id',s.id,'stop_type',s.stop_type,'sequence',s.sequence,'address',s.address,
    'contact_name',s.contact_name,'contact_phone',s.contact_phone,'status',s.status,'otp',public.courier_stop_visible_otp(s.id)) order by s.sequence)
    from public.courier_order_stops s where s.order_id=_order_id),'[]'::jsonb);
end $$;

create or replace function public.courier_contact_stop_gate(_stop_id uuid) returns public.courier_order_stops language plpgsql stable security definer set search_path=public as $$
declare _st public.courier_order_stops%rowtype; _me text; _owner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  _me := public.courier_my_phone10();
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _me is null or _st.id is null or right(regexp_replace(coalesce(_st.contact_phone,''),'\D','','g'),10)<>_me then
    raise exception 'Forbidden' using errcode='42501'; end if;
  return _st;
end $$;

create or replace function public.courier_is_next_stop(_stop_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select o.assigned_expert_id is not null
      and o.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')
      and (select n.id from public.courier_order_stops n where n.order_id=s.order_id and n.status not in ('completed','failed','cancelled') order by n.sequence limit 1)=s.id
    from public.courier_order_stops s join public.courier_orders o on o.id=s.order_id where s.id=_stop_id), false)
$$;

create or replace function public.courier_my_contact_deliveries() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare _me text := public.courier_my_phone10();
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if _me is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('order_id',o.id,'order_code',o.order_code,'stop_id',s.id,
      'role',case s.stop_type when 'pickup' then 'pickup' when 'drop' then 'drop' else 'return' end,
      'address',s.address,'stop_status',s.status,'order_status',o.status,
      'sender_label',case when s.stop_type='pickup' then split_part(coalesce(u.full_name,''),' ',1)
        else (select p.contact_name from public.courier_order_stops p where p.order_id=o.id and p.stop_type='pickup' order by p.sequence limit 1) end
    ) order by o.created_at desc, s.sequence)
    from public.courier_order_stops s join public.courier_orders o on o.id=s.order_id
    left join public.users u on u.id=o.customer_id
    where right(regexp_replace(coalesce(s.contact_phone,''),'\D','','g'),10)=_me
      and o.customer_id<>auth.uid()
      and (o.status not in ('DELIVERED','COMPLETED','CANCELLED','FAILED_DELIVERY','EXPIRED')
           or coalesce(o.completed_at,o.delivered_at,o.cancelled_at,o.updated_at) > now()-interval '24 hours')),'[]'::jsonb);
end $$;

create or replace function public.courier_get_contact_view(_stop_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare _st public.courier_order_stops%rowtype; _o public.courier_orders%rowtype; _e record; _veh text; _ret jsonb := null; _rid uuid;
begin
  _st := public.courier_contact_stop_gate(_stop_id);
  select * into _o from public.courier_orders where id=_st.order_id;
  select name into _veh from public.courier_vehicle_types where id=_o.vehicle_type_id;
  if _o.assigned_expert_id is not null then select name, photo_url into _e from public.experts where id=_o.assigned_expert_id; end if;
  if _st.stop_type='pickup' then
    select p.return_stop_id into _rid from public.courier_order_parcels p where p.pickup_stop_id=_st.id and p.return_stop_id is not null limit 1;
    if _rid is not null then
      select jsonb_build_object('stop_id',r.id,'status',r.status,'otp',public.courier_stop_visible_otp(r.id)) into _ret from public.courier_order_stops r where r.id=_rid;
    end if;
  end if;
  return jsonb_build_object(
    'stop', jsonb_build_object('stop_id',_st.id,'stop_type',_st.stop_type,'sequence',_st.sequence,'address',_st.address,'lat',_st.lat,'lng',_st.lng,
       'contact_name',_st.contact_name,'status',_st.status,'arrived_at',_st.arrived_at,'completed_at',_st.completed_at),
    'order_id',_o.id,'order_code',_o.order_code,'order_status',_o.status,
    'rider', case when _o.assigned_expert_id is null then jsonb_build_object('available',false)
      else jsonb_build_object('available',true,'name',_e.name,'photo_url',_e.photo_url,'vehicle',_veh) end,
    'is_next_stop', public.courier_is_next_stop(_st.id),
    'otp', public.courier_stop_visible_otp(_st.id),
    'return_stop', _ret);
end $$;

create or replace function public.courier_get_rider_location_for_stop(_stop_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare _st public.courier_order_stops%rowtype; _o public.courier_orders%rowtype; _e record; _lim int; _cnt int; _stale int;
begin
  _st := public.courier_contact_stop_gate(_stop_id);
  if not public.courier_is_next_stop(_st.id) then return jsonb_build_object('available',false,'reason','not_next_stop'); end if;
  select * into _o from public.courier_orders where id=_st.order_id;
  _lim := public.courier_setting('courier_location_read_per_min', 12)::int;
  select count(*) into _cnt from public.courier_location_read_log where customer_id=auth.uid() and created_at>now()-interval '1 minute';
  if _cnt>=_lim then raise exception 'Too many location requests, please slow down' using errcode='P0001'; end if;
  insert into public.courier_location_read_log(customer_id) values (auth.uid());
  select current_lat, current_lng, location_updated_at into _e from public.experts where id=_o.assigned_expert_id;
  if _e.current_lat is null or _e.current_lng is null then return jsonb_build_object('available',false,'reason','no_fix'); end if;
  _stale := public.courier_setting('courier_location_stale_seconds', 120)::int;
  return jsonb_build_object('available',true,'lat',_e.current_lat,'lng',_e.current_lng,'location_updated_at',_e.location_updated_at,
    'stale', coalesce(_e.location_updated_at < now()-make_interval(secs=>_stale), true));
end $$;

create or replace function public.courier_notify_stop_contact(_stop_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare _st public.courier_order_stops%rowtype; _owner uuid; _p text; _uid uuid;
begin
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then return; end if;
  _p := right(regexp_replace(coalesce(_st.contact_phone,''),'\D','','g'),10);
  if length(_p)<10 then return; end if;
  select customer_id into _owner from public.courier_orders where id=_st.order_id;
  for _uid in
    select u.id from public.users u left join auth.users a on a.id=u.id
     where u.deleted_at is null and u.id<>_owner
       and right(regexp_replace(coalesce(nullif(a.phone,''),u.phone,''),'\D','','g'),10)=_p
     limit 3
  loop
    perform public.notify_customer_user_push(_uid,'Parcel update','Open Badiyos to see your OTP','/');
  end loop;
exception when others then null;
end $$;

create or replace function public.courier_issue_stop_otp(_stop_id uuid) returns text language plpgsql security definer set search_path=public as $function$
declare _st public.courier_order_stops%rowtype; _p text; _issued timestamptz := clock_timestamp(); _prev timestamptz; _otp text;
begin
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  _p := public.courier_stop_purpose(_st.stop_type);
  insert into public.courier_stop_secrets(stop_id) values (_stop_id) on conflict do nothing;
  select otp_issued_at into _prev from public.courier_stop_secrets where stop_id=_stop_id for update;
  if _prev is not null and _issued <= _prev then _issued := _prev + interval '1 microsecond'; end if;
  _otp := public.courier_derive_otp(_stop_id, _p, _issued);
  update public.courier_stop_secrets
     set otp_hash=public.courier_hash_otp(_otp), otp_issued_at=_issued,
         otp_expires_at=clock_timestamp()+interval '12 hours', attempts=0, updated_at=now()
   where stop_id=_stop_id;
  begin perform public.courier_notify_stop_contact(_stop_id); exception when others then null; end;
  return _otp;
end $function$;

revoke all on function public.courier_my_phone10(), public.courier_stop_visible_otp(uuid), public.courier_contact_stop_gate(uuid), public.courier_is_next_stop(uuid), public.courier_notify_stop_contact(uuid) from public, anon, authenticated;
grant execute on function public.courier_my_phone10(), public.courier_stop_visible_otp(uuid), public.courier_contact_stop_gate(uuid), public.courier_is_next_stop(uuid), public.courier_notify_stop_contact(uuid) to service_role;
revoke all on function public.courier_get_order_otps(uuid), public.courier_my_contact_deliveries(), public.courier_get_contact_view(uuid), public.courier_get_rider_location_for_stop(uuid) from public, anon;
grant execute on function public.courier_get_order_otps(uuid), public.courier_my_contact_deliveries(), public.courier_get_contact_view(uuid), public.courier_get_rider_location_for_stop(uuid) to authenticated, service_role;
revoke all on function public.courier_issue_stop_otp(uuid) from public, anon, authenticated;