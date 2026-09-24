-- 2. Shared progress helper
CREATE OR REPLACE FUNCTION public.courier_recompute_order_progress(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _o public.courier_orders%rowtype; _issued uuid[] := '{}'; _d record; _status text;
begin
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null then raise exception 'Order not found'; end if;

  if _o.status in ('ARRIVED_PICKUP','PICKED_UP')
     and not exists (select 1 from public.courier_order_stops where order_id=_order_id and stop_type='pickup'
                      and status not in ('completed','failed','cancelled')) then
    if not exists (select 1 from public.courier_order_parcels where order_id=_order_id and status='picked') then
      update public.courier_orders
         set status='CANCELLED', cancelled_by='rider', cancel_reason_code='ALL_PICKUPS_FAILED',
             cancelled_at=now(), needs_ops_attention=false
       where id=_order_id;
      perform public.notify_customer_user_push(_o.customer_id, 'Pickup could not be completed',
        'The rider could not collect your parcel, so this order has been closed.', 'home');
    else
      update public.courier_orders set status='IN_TRANSIT', in_transit_at=now() where id=_order_id;
      for _d in select s.id from public.courier_order_stops s
                 where s.order_id=_order_id and s.stop_type='drop' and s.status='pending'
                   and exists (select 1 from public.courier_order_parcels p where p.drop_stop_id=s.id and p.status='picked')
                 order by s.sequence loop
        perform public.courier_issue_stop_otp(_d.id);
        _issued := array_append(_issued, _d.id);
      end loop;
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_order_id, _o.status, 'IN_TRANSIT', coalesce(current_setting('app.courier_actor_type', true),'system'),
              nullif(current_setting('app.courier_actor_id', true),'')::uuid,
              jsonb_build_object('event','drop_otps_issued','issued_stop_ids',to_jsonb(_issued)));
      perform public.notify_customer_user_push(_o.customer_id, 'On the way',
        'Your parcel is on the way to the drop location.', 'home');
    end if;
  end if;

  -- drops with nothing left to deliver
  for _d in select s.id from public.courier_order_stops s
             where s.order_id=_order_id and s.stop_type='drop' and s.status='pending'
               and not exists (select 1 from public.courier_order_parcels p
                                where p.drop_stop_id=s.id and p.status in ('pending','picked')) loop
    update public.courier_order_stops set status='cancelled', updated_at=now() where id=_d.id;
    insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
    values (_order_id, null, null, 'system', null, jsonb_build_object('event','stop_cancelled','stop_id',_d.id));
  end loop;

  select status into _status from public.courier_orders where id=_order_id;
  if _status = 'IN_TRANSIT'
     and not exists (select 1 from public.courier_order_stops where order_id=_order_id
                      and status not in ('completed','failed','cancelled')) then
    if exists (select 1 from public.courier_order_parcels where order_id=_order_id and status='delivered') then
      update public.courier_orders set status='DELIVERED', delivered_at=now() where id=_order_id;
    else
      update public.courier_orders set status='FAILED_DELIVERY' where id=_order_id;
    end if;
  end if;

  select status into _status from public.courier_orders where id=_order_id;
  return jsonb_build_object('issued_stop_ids', to_jsonb(_issued), 'order_status', _status);
end $f$;

-- 4. Arrive: return stops allowed after all drops are done
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
    if _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;
    if exists (select 1 from public.courier_order_stops where order_id=_o.id and stop_type='drop'
                and status not in ('completed','failed','cancelled')) then
      raise exception 'Finish all drops before the return'; end if;
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

-- 2/4. Verify on the helper, with return stops
CREATE OR REPLACE FUNCTION public.courier_verify_stop_otp(_stop_id uuid, _otp text, _proof_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype; _s public.courier_stop_secrets%rowtype;
        _attempts int; _ndrops int; _pos int; _body text; _pending numeric; _h jsonb;
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
end $f$;

-- 3. Fail a stop
CREATE OR REPLACE FUNCTION public.courier_rider_fail_stop(_stop_id uuid, _reason_code text, _notes text DEFAULT NULL,
  _return_distances jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype;
        _wait int := public.courier_setting('courier_fail_wait_minutes', 10)::int;
        _pk record; _ps public.courier_order_stops%rowtype; _ret uuid; _origin public.courier_order_stops%rowtype;
        _km numeric; _hav numeric; _seq int; _rpk numeric; _amt numeric; _gstp numeric; _gst numeric; _cid uuid;
        _issued uuid[] := '{}'; _charges uuid[] := '{}'; _chg_total numeric := 0; _pos int; _h jsonb; _msg text;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;

  if _st.stop_type = 'return' then raise exception 'Return stops cannot be marked failed. Please contact support.'; end if;
  if _st.status <> 'arrived' then raise exception 'Mark arrived at this stop first'; end if;
  if _st.arrived_at + make_interval(mins => _wait) > now() then
    raise exception 'You can mark this after % minutes at the location',
      ceil(extract(epoch from (_st.arrived_at + make_interval(mins => _wait) - now())) / 60)::int;
  end if;

  perform set_config('app.courier_actor_type','rider',true);
  perform set_config('app.courier_actor_id', _eid::text, true);

  if _st.stop_type = 'pickup' then
    if _reason_code not in ('SENDER_UNAVAILABLE','PARCEL_NOT_READY','PROHIBITED_ITEM','OTHER') then
      raise exception 'Invalid reason'; end if;
    update public.courier_order_stops set status='failed', failed_at=now(), fail_reason_code=_reason_code, updated_at=now() where id=_stop_id;
    update public.courier_order_parcels set status='cancelled', updated_at=now() where pickup_stop_id=_stop_id and status='pending';
    insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
    values (_o.id, _o.status, _o.status, 'rider', _eid,
            jsonb_build_object('event','stop_failed','stop_id',_stop_id,'stop_type','pickup','reason',_reason_code,'notes',left(coalesce(_notes,''),500)));
  else
    if _o.status <> 'IN_TRANSIT' then raise exception 'Parcel must be in transit first'; end if;
    if _reason_code not in ('RECEIVER_UNAVAILABLE','RECEIVER_REFUSED','WRONG_ADDRESS','UNREACHABLE','OTHER') then
      raise exception 'Invalid reason'; end if;
    update public.courier_order_stops set status='failed', failed_at=now(), fail_reason_code=_reason_code, updated_at=now() where id=_stop_id;
    update public.courier_order_parcels set status='returning', updated_at=now() where drop_stop_id=_stop_id and status='picked';
    insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
    values (_o.id, _o.status, _o.status, 'rider', _eid,
            jsonb_build_object('event','stop_failed','stop_id',_stop_id,'stop_type','drop','reason',_reason_code,'notes',left(coalesce(_notes,''),500)));

    for _pk in select p.pickup_stop_id, min(s.sequence) seq from public.courier_order_parcels p
                 join public.courier_order_stops s on s.id=p.pickup_stop_id
                where p.drop_stop_id=_stop_id and p.status='returning' and p.return_stop_id is null
                group by p.pickup_stop_id order by 2 loop
      select * into _ps from public.courier_order_stops where id=_pk.pickup_stop_id;
      select r.id into _ret from public.courier_order_stops r
       where r.order_id=_o.id and r.stop_type='return' and r.status not in ('completed','failed','cancelled')
         and exists (select 1 from public.courier_order_parcels x where x.return_stop_id=r.id and x.pickup_stop_id=_pk.pickup_stop_id)
       limit 1;
      if _ret is not null then
        update public.courier_order_parcels set return_stop_id=_ret, updated_at=now()
         where drop_stop_id=_stop_id and pickup_stop_id=_pk.pickup_stop_id and status='returning' and return_stop_id is null;
        continue;
      end if;

      -- leg origin: previous return stop, else last drop
      select * into _origin from public.courier_order_stops where order_id=_o.id and stop_type='return' order by sequence desc limit 1;
      if _origin.id is null then
        select * into _origin from public.courier_order_stops where order_id=_o.id and stop_type='drop' order by sequence desc limit 1;
      end if;
      if _return_distances is null or (_return_distances->>(_pk.pickup_stop_id::text)) is null then
        raise exception 'RETURN_DISTANCE_MISSING'; end if;
      _km := (_return_distances->>(_pk.pickup_stop_id::text))::numeric;
      _hav := public.haversine_km(_origin.lat, _origin.lng, _ps.lat, _ps.lng);
      if _km < _hav * 0.95 - 0.2 or _km > _hav * 2 + 1 then raise exception 'RETURN_DISTANCE_INVALID'; end if;

      select coalesce(max(sequence),0) + 1 into _seq from public.courier_order_stops where order_id=_o.id;
      insert into public.courier_order_stops(order_id, stop_type, sequence, lat, lng, address, contact_name, contact_phone)
      values (_o.id, 'return', _seq, _ps.lat, _ps.lng, _ps.address, _ps.contact_name, _ps.contact_phone)
      returning id into _ret;
      update public.courier_order_parcels set return_stop_id=_ret, updated_at=now()
       where drop_stop_id=_stop_id and pickup_stop_id=_pk.pickup_stop_id and status='returning' and return_stop_id is null;

      select return_per_km into _rpk from public.courier_vehicle_rates
       where lower(trim(city))=lower(trim(_o.city)) and vehicle_type_id=_o.vehicle_type_id and customer_segment='regular' limit 1;
      _amt := round(coalesce(_rpk,0) * _km, 2);
      _gstp := public.get_gst_percent();
      _gst := round(_amt * _gstp / 100, 2);
      insert into public.courier_order_charges(order_id, parcel_id, charge_type, distance_km, amount, gst_percent, gst_amount, total_amount, status)
      values (_o.id, (select id from public.courier_order_parcels where return_stop_id=_ret order by created_at limit 1),
              'return', _km, _amt, _gstp, _gst, _amt + _gst, case when _amt = 0 then 'waived' else 'pending' end)
      returning id into _cid;
      _charges := array_append(_charges, _cid);
      if _amt > 0 then _chg_total := _chg_total + _amt + _gst; end if;

      perform public.courier_issue_stop_otp(_ret);
      _issued := array_append(_issued, _ret);
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_o.id, _o.status, _o.status, 'rider', _eid,
              jsonb_build_object('event','return_created','stop_id',_ret,'from_stop_id',_stop_id,'charge_id',_cid,
                                 'distance_km',_km,'amount',_amt + _gst));
    end loop;

    select count(*) into _pos from public.courier_order_stops where order_id=_o.id and stop_type='drop' and sequence <= _st.sequence;
    _msg := format('Delivery could not be completed at drop %s.', _pos);
    if _chg_total > 0 then
      _msg := _msg || format(' Return charge ₹%s, please pay in the app to receive your parcel back.', to_char(_chg_total,'FM999999990.00'));
    end if;
    perform public.notify_customer_user_push(_o.customer_id, 'Delivery not completed', _msg, 'home');
  end if;

  _h := public.courier_recompute_order_progress(_o.id);
  return jsonb_build_object('ok', true,
    'issued_stop_ids', to_jsonb(_issued) || coalesce(_h->'issued_stop_ids','[]'::jsonb),
    'charge_ids', to_jsonb(_charges), 'order_status', _h->>'order_status');
end $f$;

-- 5. Charge paid (server only)
CREATE OR REPLACE FUNCTION public.courier_mark_charge_paid(_razorpay_order_id text, _payment_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _c public.courier_order_charges%rowtype; _eid uuid;
begin
  select * into _c from public.courier_order_charges where razorpay_order_id=_razorpay_order_id for update;
  if _c.id is null then return false; end if;
  if _c.status = 'paid' then return true; end if;
  update public.courier_order_charges
     set status='paid', paid_at=now(), razorpay_payment_id=_payment_id, updated_at=now()
   where id=_c.id;
  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_c.order_id, null, null, 'system', null,
          jsonb_build_object('event','return_charge_paid','charge_id',_c.id,'previous_status',_c.status,'payment_id',_payment_id));
  select assigned_expert_id into _eid from public.courier_orders where id=_c.order_id;
  if _eid is not null then
    perform public.notify_expert_push(_eid, 'Return charge paid', 'Return charge paid, you can complete the return.', 'home');
  end if;
  return true;
end $f$;

-- 5. Staff waive
CREATE OR REPLACE FUNCTION public.staff_courier_waive_charge(_charge_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _c public.courier_order_charges%rowtype; _eid uuid;
begin
  if not public.courier_is_ops_staff() then raise exception 'Forbidden' using errcode='42501'; end if;
  if coalesce(trim(_reason),'') = '' then raise exception 'Reason is required'; end if;
  select * into _c from public.courier_order_charges where id=_charge_id for update;
  if _c.id is null then raise exception 'Charge not found'; end if;
  if _c.status <> 'pending' then raise exception 'Only pending charges can be waived'; end if;
  update public.courier_order_charges set status='waived', updated_at=now() where id=_charge_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'courier_charge_waived', 'courier_order_charges', _charge_id,
          jsonb_build_object('status',_c.status,'total_amount',_c.total_amount),
          jsonb_build_object('status','waived','reason',_reason));
  insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
  values (_c.order_id, null, null, 'staff', auth.uid(), jsonb_build_object('event','return_charge_waived','charge_id',_charge_id,'reason',_reason));
  select assigned_expert_id into _eid from public.courier_orders where id=_c.order_id;
  if _eid is not null then
    perform public.notify_expert_push(_eid, 'Return charge waived', 'You can complete the return now.', 'home');
  end if;
  return jsonb_build_object('ok', true);
end $f$;

-- 7. Settlement
CREATE OR REPLACE FUNCTION public.courier_settle_order(_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare _o public.courier_orders%rowtype; _earn numeric; _pct numeric; _extra numeric;
begin
  select * into _o from public.courier_orders where id=_order_id for update;
  if _o.id is null or _o.earnings_credited_at is not null then return; end if;

  select coalesce(sum(amount),0) into _extra from public.courier_order_charges where order_id=_o.id and status='paid';

  if _o.status = 'DELIVERED' then
    update public.courier_orders set status='COMPLETED', completed_at=now() where id=_o.id;
    _earn := round((_o.base_amount + _o.extra_fee) * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'FAILED_DELIVERY' then
    _pct := public.courier_setting('courier_failed_delivery_payout_pct', 50);
    _earn := round(_o.base_amount * _pct / 100 * (100 - _o.commission_pct) / 100, 2);
  elsif _o.status = 'CANCELLED' and _o.cancel_reason_code = 'ALL_PICKUPS_FAILED' then
    _earn := round((_o.base_amount + _o.extra_fee) * (100 - _o.commission_pct) / 100, 2);
  else
    return;
  end if;

  if _extra > 0 then
    _earn := _earn + round(_extra * (100 - _o.commission_pct) / 100, 2);
  end if;

  if _o.assigned_expert_id is not null and _earn > 0 then
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason)
    values ('expert', _o.assigned_expert_id, _earn, 'credit', 'courier_order:' || _o.id::text);
    update public.experts set wallet_balance = coalesce(wallet_balance,0) + _earn, is_busy = false
     where id = _o.assigned_expert_id;
    perform public.notify_expert_push(_o.assigned_expert_id, 'Earning credited',
      'Rs ' || _earn::text || ' added to your wallet for a courier delivery.', 'wallet');
  end if;

  update public.courier_orders set earnings_credited_at = now() where id = _o.id;
end $f$;

-- 6/7. Tick: escalation + settle all-pickups-failed
CREATE OR REPLACE FUNCTION public.courier_sweeper_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
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
      values (_r.id, null, null, 'system', null, jsonb_build_object('event','return_payment_escalated'));
      perform public.admin_alert_enqueue('courier_return_payment', _r.id, coalesce(_r.order_code,'Parcel return'),
                                         'Return charge unpaid', _r.total_amount, 'Now');
    end loop;

    for _r in select id from public.courier_orders
               where status='CANCELLED' and cancel_reason_code='ALL_PICKUPS_FAILED' and earnings_credited_at is null loop
      perform set_config('app.courier_actor_type','system',true);
      perform public.courier_settle_order(_r.id);
    end loop;
  exception when others then raise warning 'courier_sweeper_tick extras failed: %', sqlerrm;
  end;
end $f$;

-- Grants
REVOKE ALL ON FUNCTION public.courier_recompute_order_progress(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.courier_mark_charge_paid(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_recompute_order_progress(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.courier_mark_charge_paid(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.courier_rider_fail_stop(uuid, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_courier_waive_charge(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_rider_fail_stop(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_courier_waive_charge(uuid, text) TO authenticated, service_role;