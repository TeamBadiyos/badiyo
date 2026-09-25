
-- 1. Skill category + columns
insert into public.service_categories (segment_id, name, slug, rank, is_active)
select c.segment_id, 'Bulk Delivery', 'bulk-delivery', 2, true
  from public.service_categories c where c.slug='courier-delivery'
   and not exists (select 1 from public.service_categories x where x.segment_id=c.segment_id and x.slug='bulk-delivery')
 limit 1;

alter table public.courier_orders add column if not exists required_skill_id uuid references public.service_categories(id);
alter table public.business_orders add column if not exists requeued_from_id uuid references public.business_orders(id);
create index if not exists idx_business_orders_parcel on public.business_orders(parcel_id);
create index if not exists idx_business_orders_courier on public.business_orders(courier_order_id);

-- 2. Business push helper (Merchant App endpoint used by notify_merchant_new_order)
create or replace function public.business_notify(_merchant_id uuid, _title text, _body text, _data jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public','extensions' as $$
declare _base text := 'https://project--981f7dd4-309e-4614-b96b-67bc34bd1fdd.lovable.app'; _secret text;
begin
  begin
    if _merchant_id is null then return; end if;
    select value into _secret from public.edge_runtime_config where key='push_trigger_secret';
    if _secret is null or _secret='' then return; end if;
    perform net.http_post(url := _base || '/api/public/merchant-send-push',
      headers := jsonb_build_object('content-type','application/json','x-trigger-secret',_secret),
      body := jsonb_build_object('merchant_id',_merchant_id,'alert_type','business_delivery',
        'title',_title,'body',_body,'data',coalesce(_data,'{}'::jsonb)));
  exception when others then raise warning '[business_notify] %: %', _merchant_id, sqlerrm;
  end;
end $$;
revoke execute on function public.business_notify(uuid,text,text,jsonb) from public, anon, authenticated;

-- 3. Customer pushes skip business owners who have no customer account
create or replace function public.notify_customer_user_push(_user_id uuid, _title text, _body text, _route text)
returns void language plpgsql security definer set search_path to 'public','extensions' as $$
begin
  if _user_id is null then return; end if;
  if exists (select 1 from public.merchants m where m.auth_user_id=_user_id)
     and not exists (select 1 from public.users u where u.id=_user_id) then
    return;
  end if;
  perform public.notify_push_event('customer', _user_id, 'general', _title, _body, jsonb_build_object('route', _route));
end $$;

-- 4. Eligible riders: extra required-skill rule
CREATE OR REPLACE FUNCTION public.courier_eligible_riders(_order_id uuid, _radius numeric)
 RETURNS TABLE(expert_id uuid, distance_km numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _o public.courier_orders%rowtype; _skill uuid; _buffer int; _state jsonb; _cut int;
begin
  select * into _o from public.courier_orders where id = _order_id;
  if _o.id is null then return; end if;
  if public.courier_setting('service_hours_enforce', 0)::int = 1 then
    _state := public.service_effective_state('courier', coalesce(_o.city, 'Latur'), now());
    if coalesce((_state->>'can_order')::boolean, true) = false then return; end if;
    _cut := public.courier_setting('courier_last_order_buffer_minutes', 30)::int;
    if (_state->>'close_time') is not null
       and (now() at time zone 'Asia/Kolkata')::time
           >= ((_state->>'close_time')::time - make_interval(mins => greatest(_cut, 0))) then
      return;
    end if;
  end if;
  select required_skill into _skill from public.courier_vehicle_types where id = _o.vehicle_type_id;
  _buffer := public.courier_setting('courier_slot_buffer_minutes', 90)::int;
  return query
  select e.id, public.haversine_km(e.current_lat, e.current_lng, _o.pickup_lat, _o.pickup_lng)
  from public.experts e
  where e.is_online = true
    and coalesce(e.is_busy,false) = false
    and e.status = 'active'
    and e.current_lat is not null and e.current_lng is not null
    and (e.location_updated_at is null or e.location_updated_at > now() - interval '15 minutes')
    and public.haversine_km(e.current_lat, e.current_lng, _o.pickup_lat, _o.pickup_lng) <= _radius
    and (_skill is null or exists (
      select 1 from public.partner_skills ps
      where ps.expert_id = e.id and ps.status = 'approved' and ps.service_category_id = _skill))
    and (_o.required_skill_id is null or exists (
      select 1 from public.partner_skills ps2
      where ps2.expert_id = e.id and ps2.status = 'approved' and ps2.service_category_id = _o.required_skill_id))
    and not exists (
      select 1 from public.courier_orders c
      where c.assigned_expert_id = e.id
        and c.status in ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT'))
    and not exists (
      select 1 from public.bookings b
      where b.assigned_expert_id = e.id
        and b.status in ('confirmed','accepted','expert_assigned','in_progress')
        and b.deleted_at is null
        and public.courier_booking_start_at(b.scheduled_date, b.scheduled_time_slot)
              <= now() + make_interval(mins => _buffer))
    and not exists (
      select 1 from public.courier_offers o
      where o.order_id = _order_id and o.expert_id = e.id
        and o.status in ('pending','rejected','expired'))
  order by 2 asc;
end $function$;

-- 5. Business courier order: required skill, orders stay 'batched' until pickup
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
                  from public.business_orders o where o.batch_id=_batch_id and o.receiver_id=_rid), 'Parcel'))
    returning id into _parcel_id;
    update public.business_orders
       set courier_order_id=_cid, drop_stop_id=_sid, parcel_id=_parcel_id
     where batch_id=_batch_id and receiver_id=_rid;
  end loop;
  return _cid;
end $function$;

-- 6. Finalize: snapshot return_per_km, low-balance push to business
CREATE OR REPLACE FUNCTION public.business_finalize_batch(_batch_id uuid, _distance_km numeric, _distance_source text, _receiver_order uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    'commission_pct', coalesce(_pl.commission_pct,0),
    'return_per_km', coalesce(_pl.return_per_km,0));

  if coalesce(_m.delivery_wallet_balance,0) < _total then
    update public.business_batches
       set status='awaiting_balance', fail_reason='LOW_BALANCE', total_amount=_total,
           fare_breakdown=_fb, distance_km=_distance_km, distance_source=_distance_source, claimed_at=null
     where id=_batch_id;
    perform public.business_notify(_b.merchant_id, 'Low wallet balance',
      'Top up to dispatch ' || (select count(*) from public.business_orders where batch_id=_batch_id) || ' orders',
      jsonb_build_object('batch_id',_batch_id,'needed',_total));
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
  update public.business_orders set status='pending', batch_id=null, batched_at=null, courier_order_id=null, parcel_id=null, drop_stop_id=null
   where batch_id=_batch_id and status='batched';
  return jsonb_build_object('ok', false, 'reason', left(sqlerrm,200));
end $function$;

-- 7. Rider fail stop: business return charge from wallet
CREATE OR REPLACE FUNCTION public.courier_rider_fail_stop(_stop_id uuid, _reason_code text, _notes text DEFAULT NULL::text, _return_distances jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _eid uuid; _o public.courier_orders%rowtype; _st public.courier_order_stops%rowtype;
        _wait int := public.courier_setting('courier_fail_wait_minutes', 10)::int;
        _pk record; _ps public.courier_order_stops%rowtype; _ret uuid; _origin public.courier_order_stops%rowtype;
        _km numeric; _hav numeric; _seq int; _rpk numeric; _amt numeric; _gstp numeric; _gst numeric; _cid uuid;
        _issued uuid[] := '{}'; _charges uuid[] := '{}'; _chg_total numeric := 0; _pos int; _h jsonb; _msg text;
        _biz boolean;
begin
  _eid := public.get_expert_id_for_auth(auth.uid());
  if _eid is null then raise exception 'Not a rider' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id;
  if _st.id is null then raise exception 'Stop not found'; end if;
  select * into _o from public.courier_orders where id=_st.order_id for update;
  if _o.assigned_expert_id is distinct from _eid then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into _st from public.courier_order_stops where id=_stop_id for update;
  _biz := coalesce(_o.source,'') = 'business' and _o.business_merchant_id is not null;

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

      if _biz then
        _rpk := coalesce(nullif(_o.fare_breakdown->>'return_per_km','')::numeric,
                         (select pl.return_per_km from public.bulk_pricing_plans pl
                           where pl.id = nullif(_o.fare_breakdown->>'plan_id','')::uuid), 0);
      else
        select return_per_km into _rpk from public.courier_vehicle_rates
         where lower(trim(city))=lower(trim(_o.city)) and vehicle_type_id=_o.vehicle_type_id and customer_segment='regular' limit 1;
      end if;
      _amt := round(coalesce(_rpk,0) * _km, 2);
      _gstp := public.get_gst_percent();
      _gst := round(_amt * _gstp / 100, 2);
      insert into public.courier_order_charges(order_id, parcel_id, charge_type, distance_km, amount, gst_percent, gst_amount, total_amount, status)
      values (_o.id, (select id from public.courier_order_parcels where return_stop_id=_ret order by created_at limit 1),
              'return', _km, _amt, _gstp, _gst, _amt + _gst, case when _amt = 0 then 'waived' else 'pending' end)
      returning id into _cid;
      if _biz and _amt > 0 then
        perform public.business_wallet_post(_o.business_merchant_id, 'debit', _amt + _gst, 'return:' || _cid::text, true, null);
        update public.courier_order_charges set status='paid', paid_at=now(), updated_at=now() where id=_cid;
      end if;
      _charges := array_append(_charges, _cid);
      if _amt > 0 then _chg_total := _chg_total + _amt + _gst; end if;

      perform public.courier_issue_stop_otp(_ret);
      _issued := array_append(_issued, _ret);
      insert into public.courier_order_events(order_id, from_status, to_status, actor_type, actor_id, meta)
      values (_o.id, _o.status, _o.status, 'rider', _eid,
              jsonb_build_object('event','return_created','stop_id',_ret,'from_stop_id',_stop_id,'charge_id',_cid,
                                 'distance_km',_km,'amount',_amt + _gst,'paid_from_wallet',_biz and _amt > 0));
    end loop;

    if _biz then
      perform public.business_notify(_o.business_merchant_id, 'Delivery failed',
        format('Delivery failed at %s, parcel returning. ₹%s charged.',
               coalesce(nullif(_st.contact_name,''), 'receiver'), to_char(_chg_total,'FM999999990.00')),
        jsonb_build_object('courier_order_id',_o.id,'stop_id',_stop_id));
    else
      select count(*) into _pos from public.courier_order_stops where order_id=_o.id and stop_type='drop' and sequence <= _st.sequence;
      _msg := format('Delivery could not be completed at drop %s.', _pos);
      if _chg_total > 0 then
        _msg := _msg || format(' Return charge ₹%s, please pay in the app to receive your parcel back.', to_char(_chg_total,'FM999999990.00'));
      end if;
      perform public.notify_customer_user_push(_o.customer_id, 'Delivery not completed', _msg, 'home');
    end if;
  end if;

  _h := public.courier_recompute_order_progress(_o.id);
  return jsonb_build_object('ok', true,
    'issued_stop_ids', to_jsonb(_issued) || coalesce(_h->'issued_stop_ids','[]'::jsonb),
    'charge_ids', to_jsonb(_charges), 'order_status', _h->>'order_status');
end $function$;

-- 8. Parcel status -> business orders
create or replace function public.business_sync_from_parcel()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if NEW.status = 'picked' then
    update public.business_orders set status='in_transit' where parcel_id=NEW.id and status in ('batched','pending');
  elsif NEW.status = 'delivered' then
    update public.business_orders set status='delivered', delivered_at=now() where parcel_id=NEW.id and status in ('batched','in_transit');
  elsif NEW.status = 'returned' then
    update public.business_orders set status='returned' where parcel_id=NEW.id and status in ('batched','in_transit');
  end if;
  return NEW;
end $$;
revoke execute on function public.business_sync_from_parcel() from public, anon, authenticated;
drop trigger if exists trg_business_sync_from_parcel on public.courier_order_parcels;
create trigger trg_business_sync_from_parcel after update of status on public.courier_order_parcels
for each row execute function public.business_sync_from_parcel();

-- 9. Business orders never go through the card refund worker
create or replace function public.business_courier_no_card_refund()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.source = 'business' and NEW.refund_status = 'refund_pending' then
    NEW.refund_status := 'none';
    NEW.refund_next_attempt_at := null;
    if NEW.payment_status = 'refund_pending' then NEW.payment_status := 'paid'; end if;
  end if;
  return NEW;
end $$;
revoke execute on function public.business_courier_no_card_refund() from public, anon, authenticated;
drop trigger if exists trg_business_courier_no_card_refund on public.courier_orders;
create trigger trg_business_courier_no_card_refund before update on public.courier_orders
for each row execute function public.business_courier_no_card_refund();

-- 10. Order status -> business orders / batch / wallet refund
create or replace function public.business_sync_from_order()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _refund numeric;
begin
  if NEW.source is distinct from 'business' or NEW.status is not distinct from OLD.status then return NEW; end if;

  if NEW.status = 'CANCELLED' then
    if NEW.cancel_reason_code = 'ALL_PICKUPS_FAILED' then
      update public.business_orders set status='failed', cancel_reason='ALL_PICKUPS_FAILED', cancelled_at=now()
       where courier_order_id=NEW.id and status in ('batched','in_transit');
      update public.business_batches set status='completed' where courier_order_id=NEW.id and status='dispatched';
    elsif OLD.status in ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP') then
      update public.business_orders
         set status='pending', batch_id=null, batched_at=null, courier_order_id=null, parcel_id=null, drop_stop_id=null
       where courier_order_id=NEW.id and status in ('batched','in_transit');
      update public.business_batches set status='failed', fail_reason='CANCELLED:' || coalesce(NEW.cancel_reason_code,'')
       where courier_order_id=NEW.id and status='dispatched';
      _refund := round(greatest(0, coalesce(NEW.total_amount,0) - coalesce(NEW.cancellation_fee,0)), 2);
      if _refund > 0 and NEW.business_merchant_id is not null then
        perform public.business_wallet_post(NEW.business_merchant_id, 'credit', _refund, 'refund:' || NEW.id::text, false, null);
      end if;
    else
      -- cancelled after a failed delivery: mark anything still open as failed
      update public.business_orders set status='failed', cancel_reason=coalesce(NEW.cancel_reason_code,'CANCELLED'), cancelled_at=now()
       where courier_order_id=NEW.id and status in ('batched','in_transit');
      update public.business_batches set status='completed' where courier_order_id=NEW.id and status='dispatched';
    end if;
  elsif NEW.status in ('DELIVERED','COMPLETED','FAILED_DELIVERY') then
    update public.business_batches set status='completed' where courier_order_id=NEW.id and status='dispatched';
  end if;
  return NEW;
end $$;
revoke execute on function public.business_sync_from_order() from public, anon, authenticated;
drop trigger if exists trg_business_sync_from_order on public.courier_orders;
create trigger trg_business_sync_from_order after update of status on public.courier_orders
for each row execute function public.business_sync_from_order();

-- 11. Requeue
create or replace function public.business_requeue_order(_order_id uuid, _actor_label text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _mid uuid := public.business_require_delivery(); _o public.business_orders%rowtype; _new uuid;
begin
  select * into _o from public.business_orders where id=_order_id and merchant_id=_mid for update;
  if _o.id is null then raise exception 'Order not found'; end if;
  if _o.status not in ('failed','returned') then raise exception 'Only failed or returned orders can be sent again'; end if;
  if exists (select 1 from public.business_orders where requeued_from_id=_o.id) then
    raise exception 'This order was already sent again'; end if;
  insert into public.business_orders (merchant_id, receiver_id, pickup_point_id, reference_no, description, packet_count,
                                      status, created_by_label, requeued_from_id)
  values (_o.merchant_id, _o.receiver_id, _o.pickup_point_id, _o.reference_no, _o.description, _o.packet_count,
          'pending', left(_actor_label,120), _o.id)
  returning id into _new;
  perform public.business_audit('business_requeue_order', 'business_orders', _new,
    jsonb_build_object('from', _o.id, 'actor_label', _actor_label));
  return _new;
end $$;
revoke execute on function public.business_requeue_order(uuid,text) from public, anon;
grant execute on function public.business_requeue_order(uuid,text) to authenticated;

-- 12. Business OTP view
create or replace function public.business_get_trip_otps(_courier_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare _mid uuid := public.business_require_delivery(); _o public.courier_orders%rowtype;
begin
  select * into _o from public.courier_orders where id=_courier_order_id;
  if _o.id is null or _o.source is distinct from 'business' or _o.business_merchant_id is distinct from _mid then
    raise exception 'Forbidden' using errcode='42501'; end if;
  return jsonb_build_object('order_id',_o.id,'order_code',_o.order_code,'status',_o.status,
    'stops', coalesce((select jsonb_agg(jsonb_build_object(
      'stop_id',s.id,'stop_type',s.stop_type,'sequence',s.sequence,'address',s.address,
      'receiver_name', coalesce((select r.name from public.business_orders bo join public.business_receivers r on r.id=bo.receiver_id
                                  where bo.drop_stop_id=s.id limit 1), s.contact_name),
      'contact_name',s.contact_name,'contact_phone',s.contact_phone,'status',s.status,
      'reference_nos',(select jsonb_agg(bo.reference_no) from public.business_orders bo where bo.drop_stop_id=s.id and bo.reference_no is not null),
      'otp',public.courier_stop_visible_otp(s.id)) order by s.sequence)
      from public.courier_order_stops s where s.order_id=_o.id),'[]'::jsonb));
end $$;
revoke execute on function public.business_get_trip_otps(uuid) from public, anon;
grant execute on function public.business_get_trip_otps(uuid) to authenticated;
