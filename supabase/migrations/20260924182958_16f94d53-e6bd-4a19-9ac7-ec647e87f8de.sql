DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.courier_orders WHERE status IN ('ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')) THEN
    RAISE EXCEPTION 'Active courier orders exist, run later';
  END IF;
END $$;

-- Legacy resolution helper
CREATE OR REPLACE FUNCTION public.courier_resolve_stop(_order_id uuid, _purpose text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT id FROM (
    SELECT id, sequence, 0 AS pri FROM public.courier_order_stops
     WHERE order_id=_order_id AND stop_type = CASE _purpose WHEN 'pickup' THEN 'pickup' WHEN 'delivery' THEN 'drop' ELSE 'return' END
       AND status NOT IN ('completed','failed','cancelled')
    UNION ALL
    SELECT id, sequence, 1 FROM public.courier_order_stops
     WHERE order_id=_order_id AND stop_type = CASE _purpose WHEN 'pickup' THEN 'pickup' WHEN 'delivery' THEN 'drop' ELSE 'return' END
  ) s ORDER BY pri, sequence LIMIT 1
$f$;

CREATE OR REPLACE FUNCTION public.courier_stop_purpose(_stop_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$
  SELECT CASE _stop_type WHEN 'pickup' THEN 'pickup' WHEN 'drop' THEN 'delivery' ELSE 'return' END
$f$;

-- 1. Per-stop issue
CREATE OR REPLACE FUNCTION public.courier_issue_stop_otp(_stop_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
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
  return _otp;
end $f$;

-- 3. Legacy functions on per-stop secrets
CREATE OR REPLACE FUNCTION public.courier_issue_otp(_order_id uuid, _purpose text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _sid uuid;
begin
  _sid := public.courier_resolve_stop(_order_id, _purpose);
  if _sid is null then raise exception 'No % stop for this order', _purpose; end if;
  return public.courier_issue_stop_otp(_sid);
end $f$;

CREATE OR REPLACE FUNCTION public.courier_get_otp(_order_id uuid, _purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _o public.courier_orders%rowtype; _sid uuid; _s public.courier_stop_secrets%rowtype;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid OTP type'; end if;
  if _purpose = 'pickup' and _o.status not in ('ARRIVED_PICKUP') then
    raise exception 'Pickup OTP is available once the rider reaches the pickup point'; end if;
  if _purpose = 'delivery' and _o.status not in ('PICKED_UP','IN_TRANSIT') then
    raise exception 'Delivery OTP is available once the parcel is in transit'; end if;
  _sid := public.courier_resolve_stop(_order_id, _purpose);
  select * into _s from public.courier_stop_secrets where stop_id = _sid;
  if _s.otp_issued_at is null then raise exception 'OTP not generated yet'; end if;
  return jsonb_build_object('otp', public.courier_derive_otp(_sid, _purpose, _s.otp_issued_at));
end $f$;

CREATE OR REPLACE FUNCTION public.courier_refresh_otp(_order_id uuid, _purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _o public.courier_orders%rowtype; _sid uuid; _st public.courier_order_stops%rowtype; _s public.courier_stop_secrets%rowtype; _otp text;
begin
  _o := public.courier_otp_owner_gate(_order_id, _purpose);
  _sid := public.courier_resolve_stop(_order_id, _purpose);
  select * into _st from public.courier_order_stops where id=_sid;
  select * into _s from public.courier_stop_secrets where stop_id=_sid;
  if _s.verified_at is not null or _st.status = 'completed' then
    raise exception '% OTP is already verified', initcap(_purpose); end if;
  _otp := public.courier_issue_stop_otp(_sid);
  insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_order_id, _o.status, _o.status, 'customer', auth.uid(),
          jsonb_build_object('event','otp_refreshed','purpose',_purpose,'stop_id',_sid));
  return jsonb_build_object('otp', _otp, 'purpose', _purpose);
end $f$;

CREATE OR REPLACE FUNCTION public.courier_resend_otp(_order_id uuid, _purpose text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare
  _o public.courier_orders%rowtype; _sid uuid; _st public.courier_order_stops%rowtype; _s public.courier_stop_secrets%rowtype;
  _cooldown int := public.courier_setting('courier_otp_resend_cooldown_seconds', 60)::int;
  _max int := public.courier_setting('courier_otp_max_sends', 3)::int;
  _count int; _otp text; _phone text;
begin
  _o := public.courier_otp_owner_gate(_order_id, _purpose);
  _sid := public.courier_resolve_stop(_order_id, _purpose);
  select * into _st from public.courier_order_stops where id=_sid;
  insert into public.courier_stop_secrets(stop_id) values (_sid) on conflict do nothing;
  select * into _s from public.courier_stop_secrets where stop_id=_sid for update;
  _count := coalesce(_s.send_count,0);
  _phone := coalesce(nullif(_st.contact_phone,''), case when _purpose='pickup' then _o.pickup_contact_phone else _o.drop_contact_phone end);
  if _s.verified_at is not null or _st.status='completed' then
    raise exception '% OTP is already verified', initcap(_purpose); end if;
  if _s.last_sent_at is not null and now() < _s.last_sent_at + make_interval(secs => _cooldown) then
    raise exception 'Please wait % seconds before sending again',
      ceil(extract(epoch from (_s.last_sent_at + make_interval(secs => _cooldown)) - now()));
  end if;
  if _count >= _max then raise exception 'Resend limit reached for this OTP'; end if;
  if _s.otp_issued_at is null or _s.otp_expires_at <= now() then
    _otp := public.courier_issue_stop_otp(_sid);
  else
    _otp := public.courier_derive_otp(_sid, _purpose, _s.otp_issued_at);
  end if;
  update public.courier_stop_secrets set send_count=coalesce(send_count,0)+1, last_sent_at=now(), updated_at=now()
   where stop_id=_sid;
  insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_order_id, _o.status, _o.status, 'customer', auth.uid(),
          jsonb_build_object('event','otp_send_requested','purpose',_purpose,'stop_id',_sid,
                             'sends', _count + 1, 'phone_last4', right(coalesce(_phone,''),4)));
  return jsonb_build_object('otp', _otp, 'phone', _phone, 'purpose', _purpose,
                            'sends_used', _count + 1, 'max_sends', _max);
end $f$;

CREATE OR REPLACE FUNCTION public.merchant_get_pickup_otp(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _mid uuid; _cid uuid; _c record; _sid uuid; _s public.courier_stop_secrets%rowtype;
begin
  _mid := public.current_merchant_id();
  if _mid is null then raise exception 'not_a_merchant' using errcode='42501'; end if;
  select courier_order_id into _cid from public.merchant_orders where id = _order_id and merchant_id = _mid;
  if _cid is null then raise exception 'no_delivery_job'; end if;
  select status into _c from public.courier_orders where id = _cid;
  if _c.status <> 'ARRIVED_PICKUP' then
    return jsonb_build_object('ok', false, 'reason', 'not_arrived', 'courier_status', _c.status); end if;
  _sid := public.courier_resolve_stop(_cid, 'pickup');
  select * into _s from public.courier_stop_secrets where stop_id = _sid;
  if _s.otp_issued_at is null or _s.otp_expires_at < now() then
    return jsonb_build_object('ok', true, 'otp', public.courier_issue_stop_otp(_sid));
  end if;
  return jsonb_build_object('ok', true, 'otp', public.courier_derive_otp(_sid, 'pickup', _s.otp_issued_at));
end $f$;

CREATE OR REPLACE FUNCTION public.courier_orders_log_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
begin
  if TG_OP = 'INSERT' then
    insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (NEW.id, null, NEW.status, 'customer', NEW.customer_id, '{}'::jsonb);
  elsif NEW.status is distinct from OLD.status then
    insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (NEW.id, OLD.status, NEW.status,
            coalesce(current_setting('app.courier_actor_type', true), 'system'),
            nullif(current_setting('app.courier_actor_id', true), '')::uuid,
            jsonb_build_object('rider', NEW.assigned_expert_id, 'cancel_reason', NEW.cancel_reason_code));
  end if;
  return NEW;
end $f$;

-- 4c. Per-stop contact update
CREATE OR REPLACE FUNCTION public.courier_update_stop_contact(_stop_id uuid, _name text, _phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare
  _st public.courier_order_stops%rowtype; _o public.courier_orders%rowtype; _s public.courier_stop_secrets%rowtype;
  _cap int := public.courier_setting('courier_contact_edit_cap', 2)::int;
  _digits text; _old text; _edits int; _first boolean; _issued uuid[] := '{}'; _p text; _nm text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status in ('DELIVERED','COMPLETED','CANCELLED','FAILED_DELIVERY') then raise exception 'This order is closed'; end if;
  if _st.status not in ('pending','arrived') then raise exception 'This stop is already done'; end if;
  _p := public.courier_stop_purpose(_st.stop_type);
  _digits := regexp_replace(coalesce(_phone,''), '[^0-9]', '', 'g');
  if length(_digits) = 12 and left(_digits,2) = '91' then _digits := right(_digits,10); end if;
  if _digits !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit mobile number'; end if;
  _old := _st.contact_phone; _edits := coalesce(_st.contact_edit_count,0);
  _nm := coalesce(nullif(trim(_name),''), _st.contact_name);
  if _edits >= _cap then raise exception 'Contact number can no longer be changed for this order'; end if;
  if regexp_replace(coalesce(_old,''), '[^0-9]', '', 'g') = _digits and _nm is not distinct from _st.contact_name then
    return jsonb_build_object('changed', false, 'phone', _old, 'issued_stop_ids', to_jsonb(_issued));
  end if;
  update public.courier_order_stops set contact_phone=_digits, contact_name=_nm, contact_edit_count=_edits+1, updated_at=now()
   where id=_stop_id;
  _first := _st.id = (select id from public.courier_order_stops where order_id=_o.id and stop_type=_st.stop_type order by sequence limit 1);
  if _first and _st.stop_type='pickup' then
    update public.courier_orders set pickup_contact_phone=_digits, pickup_contact_name=_nm, pickup_contact_edit_count=_edits+1, updated_at=now() where id=_o.id;
  elsif _first and _st.stop_type='drop' then
    update public.courier_orders set drop_contact_phone=_digits, drop_contact_name=_nm, drop_contact_edit_count=_edits+1, updated_at=now() where id=_o.id;
  end if;
  select * into _s from public.courier_stop_secrets where stop_id=_stop_id;
  if _s.stop_id is not null then
    update public.courier_stop_secrets set send_count=0, last_sent_at=null, updated_at=now() where stop_id=_stop_id;
    if _s.otp_issued_at is not null then
      perform public.courier_issue_stop_otp(_stop_id);
      _issued := array_append(_issued, _stop_id);
    end if;
  end if;
  insert into public.courier_order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_o.id, _o.status, _o.status, 'customer', auth.uid(),
          jsonb_build_object('event','contact_updated','purpose',_p,'stop_id',_stop_id,
                             'old_last4', right(coalesce(_old,''),4), 'new_last4', right(_digits,4), 'edits', _edits + 1));
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_contact_updated', 'courier_orders', _o.id,
          jsonb_build_object('purpose',_p,'stop_id',_stop_id,'phone_last4', right(coalesce(_old,''),4)),
          jsonb_build_object('purpose',_p,'stop_id',_stop_id,'phone_last4', right(_digits,4),'edits', _edits + 1));
  return jsonb_build_object('changed', true, 'phone', _digits, 'edits_used', _edits + 1, 'edit_cap', _cap,
                            'issued_stop_ids', to_jsonb(_issued));
end $f$;

CREATE OR REPLACE FUNCTION public.courier_update_contact(_order_id uuid, _purpose text, _new_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _o public.courier_orders%rowtype; _sid uuid; _st public.courier_order_stops%rowtype; _r jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid contact type'; end if;
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null or _o.customer_id <> auth.uid() then raise exception 'Forbidden' using errcode='42501'; end if;
  if _o.status in ('DELIVERED','COMPLETED','CANCELLED','FAILED_DELIVERY') then raise exception 'This order is closed'; end if;
  _sid := public.courier_resolve_stop(_order_id, _purpose);
  select * into _st from public.courier_order_stops where id=_sid;
  if _st.status not in ('pending','arrived') then raise exception '% is already verified', initcap(_purpose); end if;
  _r := public.courier_update_stop_contact(_sid, null, _new_phone);
  if (_r->>'changed')::boolean then
    return jsonb_build_object('changed', true, 'phone', _r->>'phone', 'edits_used', (_r->>'edits_used')::int, 'edit_cap', (_r->>'edit_cap')::int);
  end if;
  return jsonb_build_object('changed', false, 'phone', _r->>'phone');
end $f$;

-- 4a. Arrive at stop
CREATE OR REPLACE FUNCTION public.courier_rider_arrive_stop(_stop_id uuid, _lat numeric DEFAULT NULL, _lng numeric DEFAULT NULL,
  _accuracy_m numeric DEFAULT NULL, _fix_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype; _next uuid; _dist numeric;
        _issued uuid[] := '{}'; _s public.courier_stop_secrets%rowtype;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  -- stale arrivals left by a previous rider who cancelled before pickup
  if _o.status = 'DRIVER_ASSIGNED' then
    update public.courier_order_stops set status='pending', arrived_at=null, updated_at=now()
     where order_id=_o.id and status='arrived';
    select * into _st from public.courier_order_stops where id=_stop_id;
  end if;

  if _st.status <> 'pending' then raise exception 'This stop is not pending'; end if;
  if exists (select 1 from public.courier_order_stops where order_id=_o.id and status='arrived') then
    raise exception 'Finish the current stop first'; end if;
  select id into _next from public.courier_order_stops where order_id=_o.id and status='pending' order by sequence limit 1;
  if _next is distinct from _stop_id then raise exception 'Complete the earlier stop first'; end if;

  if _st.stop_type = 'pickup' then
    if _o.status not in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP') then raise exception 'Order is not in assigned state'; end if;
  elsif _st.stop_type = 'drop' then
    if _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;
  else
    raise exception 'Return stops are not supported yet';
  end if;

  if _lat is not null and _lng is not null and _st.lat is not null and _st.lng is not null then
    _dist := public.haversine_km(_lat, _lng, _st.lat, _st.lng) * 1000;
  end if;

  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_o.id, _o.status, case when _o.status='DRIVER_ASSIGNED' then 'ARRIVED_PICKUP' else _o.status end, 'rider', _eid,
          jsonb_build_object('event','arrival_recorded','stop_id',_stop_id,'stop_type',_st.stop_type,
                             'accuracy_m',_accuracy_m,'fix_at',_fix_at,'distance_m',_dist));

  update public.courier_order_stops set status='arrived', arrived_at=now(), updated_at=now() where id=_stop_id;

  if _o.status = 'DRIVER_ASSIGNED' then
    update public.courier_orders set status='ARRIVED_PICKUP', arrived_pickup_at=now() where id=_o.id;
  end if;

  if _st.stop_type = 'pickup' then
    perform public.courier_issue_stop_otp(_stop_id);
    _issued := array_append(_issued, _stop_id);
    perform public.notify_customer_user_push(_o.customer_id, 'Rider reached pickup',
      'Share the pickup OTP with the rider to hand over the parcel.', 'home');
  else
    select * into _s from public.courier_stop_secrets where stop_id=_stop_id;
    if _s.otp_issued_at is null or _s.otp_expires_at <= now() then
      perform public.courier_issue_stop_otp(_stop_id);
      _issued := array_append(_issued, _stop_id);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'issued_stop_ids', to_jsonb(_issued));
end $f$;

-- 4b. Verify stop OTP
CREATE OR REPLACE FUNCTION public.courier_verify_stop_otp(_stop_id uuid, _otp text, _proof_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype; _s public.courier_stop_secrets%rowtype;
        _attempts int; _issued uuid[] := '{}'; _d record; _status text; _ndrops int; _pos int; _body text;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  if _st.status <> 'arrived' then raise exception 'Mark arrived at this stop first'; end if;
  if _st.stop_type = 'drop' and _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;
  if _st.stop_type = 'return' then raise exception 'Return stops are not supported yet'; end if;

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
    if not exists (select 1 from public.courier_order_stops where order_id=_o.id and stop_type='pickup'
                    and status not in ('completed','failed','cancelled')) then
      update public.courier_orders set status='IN_TRANSIT', in_transit_at=now() where id=_o.id;
      for _d in select s.id from public.courier_order_stops s
                 where s.order_id=_o.id and s.stop_type='drop' and s.status='pending'
                   and exists (select 1 from public.courier_order_parcels p where p.drop_stop_id=s.id and p.status='picked')
                 order by s.sequence loop
        perform public.courier_issue_stop_otp(_d.id);
        _issued := array_append(_issued, _d.id);
      end loop;
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_o.id, 'PICKED_UP', 'IN_TRANSIT', 'rider', _eid,
              jsonb_build_object('event','drop_otps_issued','stop_id',_stop_id,'issued_stop_ids',to_jsonb(_issued)));
      perform public.notify_customer_user_push(_o.customer_id, 'On the way',
        'Your parcel is on the way to the drop location.', 'home');
    end if;
  else
    update public.courier_order_parcels set status='delivered', updated_at=now() where drop_stop_id=_stop_id and status='picked';
    update public.courier_orders set proof_photo_url = coalesce(_proof_url, proof_photo_url) where id=_o.id;
    select count(*) into _ndrops from public.courier_order_stops where order_id=_o.id and stop_type='drop';
    select count(*) into _pos from public.courier_order_stops where order_id=_o.id and stop_type='drop' and sequence <= _st.sequence;
    _body := case when _ndrops > 1 then format('Delivered at drop %s of %s.', _pos, _ndrops)
                  else 'Your parcel has been delivered successfully.' end;
    perform public.notify_customer_user_push(_o.customer_id, 'Parcel delivered', _body, 'home');
    if not exists (select 1 from public.courier_order_stops where order_id=_o.id
                    and (status in ('arrived','pending'))) then
      if exists (select 1 from public.courier_order_parcels where order_id=_o.id and status='delivered') then
        update public.courier_orders set status='DELIVERED', delivered_at=now() where id=_o.id;
      else
        update public.courier_orders set status='FAILED_DELIVERY', needs_ops_attention=true where id=_o.id;
      end if;
    end if;
  end if;

  select status into _status from public.courier_orders where id=_o.id;
  return jsonb_build_object('ok', true, 'issued_stop_ids', to_jsonb(_issued), 'order_status', _status);
end $f$;

-- 5. Legacy wrappers
CREATE OR REPLACE FUNCTION public.courier_verify_otp(_order_id uuid, _purpose text, _otp text, _proof_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _eid uuid; _o public.courier_orders%rowtype; _sid uuid; _st public.courier_order_stops%rowtype; _r jsonb;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id = _order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  if _purpose not in ('pickup','delivery') then raise exception 'Invalid OTP type'; end if;
  _sid := public.courier_resolve_stop(_order_id, _purpose);
  select * into _st from public.courier_order_stops where id=_sid for update;
  if _purpose = 'pickup' then
    if _st.status <> 'arrived' then raise exception 'Mark arrived at pickup first'; end if;
  else
    if _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;
    if _st.status = 'pending' then
      update public.courier_order_stops set status='arrived', arrived_at=now(), updated_at=now() where id=_sid;
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_order_id, _o.status, _o.status, 'rider', _eid,
              jsonb_build_object('event','arrival_recorded','stop_id',_sid,'stop_type','drop','implied',true));
    end if;
  end if;
  _r := public.courier_verify_stop_otp(_sid, _otp, _proof_url);
  if (_r->>'ok')::boolean then return jsonb_build_object('ok', true); end if;
  return _r;
end $f$;

CREATE OR REPLACE FUNCTION public.courier_rider_advance(_order_id uuid, _to_status text, _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL, _accuracy_m numeric DEFAULT NULL, _fix_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _eid uuid; _o public.courier_orders%rowtype; _d record;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.assigned_expert_id <> _eid then raise exception 'Forbidden' using errcode='42501'; end if;

  if _to_status = 'ARRIVED_PICKUP' then
    if _o.status <> 'DRIVER_ASSIGNED' then raise exception 'Order is not in assigned state'; end if;
    perform public.courier_rider_arrive_stop(public.courier_resolve_stop(_order_id,'pickup'), _lat, _lng, _accuracy_m, _fix_at);
    return jsonb_build_object('ok', true, 'otp_issued', true);
  elsif _to_status = 'IN_TRANSIT' then
    if _o.status = 'IN_TRANSIT' then return jsonb_build_object('ok', true, 'otp_issued', true); end if;
    if _o.status <> 'PICKED_UP' then raise exception 'Parcel has not been picked up yet'; end if;
    perform set_config('app.courier_actor_type','rider',true);
    perform set_config('app.courier_actor_id', _eid::text, true);
    update public.courier_orders set status='IN_TRANSIT', in_transit_at=now() where id=_order_id;
    for _d in select s.id from public.courier_order_stops s
               where s.order_id=_order_id and s.stop_type='drop' and s.status='pending'
                 and exists (select 1 from public.courier_order_parcels p where p.drop_stop_id=s.id and p.status='picked')
               order by s.sequence loop
      perform public.courier_issue_stop_otp(_d.id);
    end loop;
    perform public.notify_customer_user_push(_o.customer_id, 'On the way',
      'Your parcel is on the way to the drop location.', 'home');
    return jsonb_build_object('ok', true, 'otp_issued', true);
  end if;
  raise exception 'Unsupported status %', _to_status;
end $f$;

-- 7. Grants
REVOKE ALL ON FUNCTION public.courier_issue_stop_otp(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_resolve_stop(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_stop_purpose(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_issue_stop_otp(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_resolve_stop(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_stop_purpose(text) TO service_role;

REVOKE ALL ON FUNCTION public.courier_rider_arrive_stop(uuid, numeric, numeric, numeric, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.courier_verify_stop_otp(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.courier_update_stop_contact(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_rider_arrive_stop(uuid, numeric, numeric, numeric, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_verify_stop_otp(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_update_stop_contact(uuid, text, text) TO authenticated, service_role;