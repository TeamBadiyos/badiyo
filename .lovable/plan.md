# Multi-stop end-to-end test script (you run it, everything rolls back)

Nothing is run or changed by me. Below is one block to paste into the Supabase SQL editor. It always ends with an error "TEST OK (rolled back) || {log}", so every change is undone. Any other error means a step failed; the message says which.

Checked before writing: the only rate is Latur / regular / bike (vehicle f5482f40-...), currently 1 pickup + 1 drop. Riders are linked to sign-in users through `experts.auth_user_id`. Parcel type used: "Other".

```sql
do $$
declare
  _veh   uuid := 'f5482f40-de63-4b69-bb6c-f23fee04f656';     -- Latur bike
  _ctype uuid := 'f85e7dd7-0114-42e6-95f6-98147312bb4b';     -- courier type "Other"
  _cust  uuid;  _eid uuid;  _auth uuid;
  _loc   record; _locs jsonb := '[]'::jsonb;
  _stops jsonb; _parcels jsonb; _dist numeric;
  _res   jsonb; _oid uuid;
  _p1 uuid; _p2 uuid; _d1 uuid; _d2 uuid;
  _log   jsonb := '[]'::jsonb;
  _otp   text; _snap jsonb;
begin
  ------------------------------------------------------------------
  -- 1. Temporarily allow 2 pickups / 4 drops, extra fees 10
  ------------------------------------------------------------------
  update public.courier_vehicle_rates
     set max_pickups = 2, max_drops = 4, extra_pickup_fee = 10, extra_drop_fee = 10
   where lower(trim(city)) = 'latur' and vehicle_type_id = _veh and customer_segment = 'regular';

  ------------------------------------------------------------------
  -- 2. Four distinct real past locations + latest customer
  ------------------------------------------------------------------
  for _loc in
    select round(lat,3) lat, round(lng,3) lng from (
      select pickup_lat lat, pickup_lng lng from public.courier_orders where pickup_lat is not null
      union all
      select drop_lat, drop_lng from public.courier_orders where drop_lat is not null
    ) x group by 1,2 order by 1,2 limit 4
  loop
    _locs := _locs || jsonb_build_object('lat', _loc.lat, 'lng', _loc.lng);
  end loop;
  if jsonb_array_length(_locs) < 4 then raise exception 'Need 4 distinct locations, found %', jsonb_array_length(_locs); end if;

  select customer_id into _cust from public.courier_orders order by created_at desc limit 1;

  _stops := jsonb_build_array(
    jsonb_build_object('key','P1','type','pickup','lat',_locs->0->'lat','lng',_locs->0->'lng','address','TEST P1','contact_name','P One','contact_phone','9876543210'),
    jsonb_build_object('key','P2','type','pickup','lat',_locs->1->'lat','lng',_locs->1->'lng','address','TEST P2','contact_name','P Two','contact_phone','9876543211'),
    jsonb_build_object('key','D1','type','drop',  'lat',_locs->2->'lat','lng',_locs->2->'lng','address','TEST D1','contact_name','D One','contact_phone','9876543212'),
    jsonb_build_object('key','D2','type','drop',  'lat',_locs->3->'lat','lng',_locs->3->'lng','address','TEST D2','contact_name','D Two','contact_phone','9876543213'));
  _parcels := jsonb_build_array(
    jsonb_build_object('pickup_key','P1','drop_key','D1','description','P1 to D1'),
    jsonb_build_object('pickup_key','P1','drop_key','D2','description','P1 to D2'),
    jsonb_build_object('pickup_key','P2','drop_key','D2','description','P2 to D2'));
  _dist := public.courier_min_route_km(_stops) * 1.3;

  _res := public.courier_create_order(_cust, jsonb_build_object(
    'city','Latur','vehicle_type_id',_veh,'courier_type_id',_ctype,
    'distance_km',_dist,'distance_source','test','weight_kg',1,
    'package_description','Multi-stop test','prohibited_items_confirmed',true,
    'stops',_stops,'parcels',_parcels));
  _oid := (_res->>'order_id')::uuid;
  if _oid is null then raise exception 'create failed: %', _res; end if;

  select id into _p1 from public.courier_order_stops where order_id=_oid and address='TEST P1';
  select id into _p2 from public.courier_order_stops where order_id=_oid and address='TEST P2';
  select id into _d1 from public.courier_order_stops where order_id=_oid and address='TEST D1';
  select id into _d2 from public.courier_order_stops where order_id=_oid and address='TEST D2';
  _log := _log || jsonb_build_object('step','created','quote',_res->'quote','distance_km',_dist);

  ------------------------------------------------------------------
  -- 3. Assign a real active rider (same fields the accept flow sets)
  ------------------------------------------------------------------
  select id, auth_user_id into _eid, _auth from public.experts
   where auth_user_id is not null and status = 'active' order by is_online desc, created_at limit 1;
  if _eid is null then raise exception 'No active expert with a login found'; end if;

  update public.courier_orders set status='SEARCHING' where id=_oid and status='REQUESTED';
  update public.courier_orders set status='DRIVER_ASSIGNED', assigned_expert_id=_eid, assigned_at=now() where id=_oid;
  update public.experts set is_busy = true where id=_eid;

  ------------------------------------------------------------------
  -- 4. Act as that rider
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', jsonb_build_object('sub',_auth,'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);   -- optional; reset below for reads
  perform set_config('role', 'postgres', true);
  if public.get_expert_id_for_auth(auth.uid()) is distinct from _eid then raise exception 'Impersonation failed'; end if;

  ------------------------------------------------------------------
  -- 5-7. Walk the stops; log order + stop statuses after each step
  ------------------------------------------------------------------
  -- helper snapshot (inline): order status + every stop's status
  -- (re-used after each step via the same select)

  _res := public.courier_rider_arrive_stop(_p1);
  select jsonb_build_object('order',(select status from public.courier_orders where id=_oid),
         'stops',(select jsonb_object_agg(address,status) from public.courier_order_stops where order_id=_oid)) into _snap;
  _log := _log || jsonb_build_object('step','arrive P1','result',_res,'state',_snap);

  -- wrong OTP first
  select public.courier_derive_otp(_p1,'pickup',otp_issued_at) into _otp from public.courier_stop_secrets where stop_id=_p1;
  _res := public.courier_verify_stop_otp(_p1, lpad(((_otp::int + 1) % 10000)::text,4,'0'));
  _log := _log || jsonb_build_object('step','verify P1 WRONG','result',_res);

  _res := public.courier_verify_stop_otp(_p1, _otp);
  select jsonb_build_object('order',(select status from public.courier_orders where id=_oid),
         'stops',(select jsonb_object_agg(address,status) from public.courier_order_stops where order_id=_oid)) into _snap;
  _log := _log || jsonb_build_object('step','verify P1','result',_res,'state',_snap);

  -- 6. Arriving at D1 during pickup phase must be rejected
  begin
    _res := public.courier_rider_arrive_stop(_d1);
    _log := _log || jsonb_build_object('step','arrive D1 early','UNEXPECTED_OK',_res);
  exception when others then
    _log := _log || jsonb_build_object('step','arrive D1 early','rejected',sqlerrm);
  end;

  _res := public.courier_rider_arrive_stop(_p2);
  select jsonb_build_object('order',(select status from public.courier_orders where id=_oid),
         'stops',(select jsonb_object_agg(address,status) from public.courier_order_stops where order_id=_oid)) into _snap;
  _log := _log || jsonb_build_object('step','arrive P2','result',_res,'state',_snap);

  select public.courier_derive_otp(_p2,'pickup',otp_issued_at) into _otp from public.courier_stop_secrets where stop_id=_p2;
  _res := public.courier_verify_stop_otp(_p2, _otp);   -- expect IN_TRANSIT + D1, D2 codes issued
  select jsonb_build_object('order',(select status from public.courier_orders where id=_oid),
         'stops',(select jsonb_object_agg(address,status) from public.courier_order_stops where order_id=_oid)) into _snap;
  _log := _log || jsonb_build_object('step','verify P2','result',_res,'state',_snap);

  _res := public.courier_rider_arrive_stop(_d1);
  select public.courier_derive_otp(_d1,'delivery',otp_issued_at) into _otp from public.courier_stop_secrets where stop_id=_d1;
  _log := _log || jsonb_build_object('step','arrive D1','result',_res);
  _res := public.courier_verify_stop_otp(_d1, _otp);
  select jsonb_build_object('order',(select status from public.courier_orders where id=_oid),
         'stops',(select jsonb_object_agg(address,status) from public.courier_order_stops where order_id=_oid)) into _snap;
  _log := _log || jsonb_build_object('step','verify D1','result',_res,'state',_snap);

  _res := public.courier_rider_arrive_stop(_d2);
  select public.courier_derive_otp(_d2,'delivery',otp_issued_at) into _otp from public.courier_stop_secrets where stop_id=_d2;
  _log := _log || jsonb_build_object('step','arrive D2','result',_res);
  _res := public.courier_verify_stop_otp(_d2, _otp);   -- expect DELIVERED
  select jsonb_build_object('order',(select status from public.courier_orders where id=_oid),
         'stops',(select jsonb_object_agg(address,status) from public.courier_order_stops where order_id=_oid)) into _snap;
  _log := _log || jsonb_build_object('step','verify D2','result',_res,'state',_snap);

  -- final parcel statuses
  _log := _log || jsonb_build_object('parcels',
    (select jsonb_object_agg(description,status) from public.courier_order_parcels where order_id=_oid));

  ------------------------------------------------------------------
  -- 8. Undo everything
  ------------------------------------------------------------------
  raise exception 'TEST OK (rolled back) || %', _log;
end $$;
```

## What to expect in the log
- "verify P1 WRONG": ok false, wrong_otp, 4 tries left.
- "arrive D1 early": rejected ("Complete the earlier stop first" or "Parcel must be in transit first").
- After "verify P2": order IN_TRANSIT and two stop ids in the issued list.
- After "verify D2": order DELIVERED, all stops completed, all 3 parcels delivered.

## Notes
- The two `set_config('role', ...)` lines are harmless no-ops; I'll remove them from the final version if you prefer — impersonation relies only on `request.jwt.claims`.
- If the create step fails (e.g. service hours closed or locations too far apart), the error text tells you why; nothing is saved.
- Push notifications may be queued during the run, but they roll back with everything else.
