
-- ============ Staff guard ============
create or replace function public.staff_require_super_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.courier_is_super_admin() then
    raise exception 'Forbidden: super_admin only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.staff_require_super_admin() from public, anon, authenticated;
grant execute on function public.staff_require_super_admin() to service_role;

-- ============ Status ============
create or replace function public.staff_set_service_status(
  _service_key text, _status text,
  _message_en text default null, _message_mr text default null,
  _resume_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare _old record; _was_live boolean;
begin
  perform public.staff_require_super_admin();
  if _status not in ('live','coming_soon','temporarily_stopped','hidden') then
    raise exception 'Invalid status';
  end if;
  select * into _old from public.service_flags where service_key = _service_key order by created_at limit 1;
  if not found then raise exception 'Unknown service %', _service_key; end if;
  _was_live := (_old.status = 'live');

  update public.service_flags set
    status = _status,
    status_message_en = coalesce(_message_en, status_message_en),
    status_message_mr = coalesce(_message_mr, status_message_mr),
    resume_at = case when _status = 'temporarily_stopped' then _resume_at else null end,
    status_updated_at = now(), status_updated_by = auth.uid()
  where id = _old.id;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_status_change', 'service_flags', _old.id,
    jsonb_build_object('status', _old.status),
    jsonb_build_object('status', _status, 'resume_at', _resume_at));

  -- Live hone par waiters ko batch push (ek user ek baar)
  if _status = 'live' and not _was_live then
    perform public.notify_service_waiters(_service_key);
  end if;

  return jsonb_build_object('ok', true, 'service_key', _service_key, 'status', _status);
end $$;

-- ============ Notify waiters (batch, ek user ek baar) ============
create or replace function public.notify_service_waiters(_service_key text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; _label text;
begin
  select label into _label from public.service_flags where service_key = _service_key limit 1;
  for r in select id, user_id from public.service_notify_requests
           where service_key = _service_key and notified_at is null loop
    perform public.notify_push_event('customer', r.user_id, 'service_live',
      coalesce(_label, _service_key) || ' is now live!',
      'Ab aap booking kar sakte hain. Open the app to book now.',
      jsonb_build_object('route', 'home'));
    update public.service_notify_requests set notified_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.notify_service_waiters(text) from public, anon, authenticated;
grant execute on function public.notify_service_waiters(text) to service_role;

-- ============ Customer: Notify me ============
create or replace function public.customer_notify_me(_service_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _existing uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select id into _existing from public.service_notify_requests
   where user_id = auth.uid() and service_key = _service_key;
  if _existing is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  insert into public.service_notify_requests (user_id, service_key) values (auth.uid(), _service_key)
  on conflict (user_id, service_key) do nothing;
  return jsonb_build_object('ok', true, 'already', false);
end $$;
revoke all on function public.customer_notify_me(text) from public, anon;
grant execute on function public.customer_notify_me(text) to authenticated, service_role;

-- ============ Hours / holidays / closed-today ============
create or replace function public.staff_set_service_hours(
  _service_key text, _weekday int, _open_time time, _close_time time, _is_closed boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare _fid uuid;
begin
  perform public.staff_require_super_admin();
  select id into _fid from public.service_flags where service_key = _service_key order by created_at limit 1;
  if _fid is null then raise exception 'Unknown service %', _service_key; end if;
  insert into public.service_hours (service_flag_id, weekday, open_time, close_time, is_closed, updated_at)
  values (_fid, _weekday, _open_time, _close_time, _is_closed, now())
  on conflict (service_flag_id, weekday)
  do update set open_time = excluded.open_time, close_time = excluded.close_time,
                is_closed = excluded.is_closed, updated_at = now();
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_hours_change', 'service_flags', _fid, null,
    jsonb_build_object('weekday', _weekday, 'open', _open_time, 'close', _close_time, 'is_closed', _is_closed));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_set_service_holiday(
  _service_key text, _start_date date, _end_date date default null,
  _reason text default null, _reason_mr text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare _fid uuid; _id uuid;
begin
  perform public.staff_require_super_admin();
  select id into _fid from public.service_flags where service_key = _service_key order by created_at limit 1;
  if _fid is null then raise exception 'Unknown service %', _service_key; end if;
  insert into public.service_holidays (service_flag_id, start_date, end_date, reason, reason_mr)
  values (_fid, _start_date, coalesce(_end_date, _start_date), _reason, _reason_mr)
  returning id into _id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_holiday_add', 'service_holidays', _id, null,
    jsonb_build_object('service_key', _service_key, 'start', _start_date, 'end', coalesce(_end_date, _start_date)));
  return jsonb_build_object('ok', true, 'id', _id);
end $$;

create or replace function public.staff_remove_service_holiday(_holiday_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_super_admin();
  delete from public.service_holidays where id = _holiday_id;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_holiday_remove', 'service_holidays', _holiday_id, null, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_close_service_today(
  _service_key text, _reason text default null, _until timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_super_admin();
  update public.service_flags set
    closed_today_date = (now() at time zone 'Asia/Kolkata')::date,
    closed_today_reason = _reason,
    closed_until = _until,
    status_updated_at = now(), status_updated_by = auth.uid()
  where service_key = _service_key;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  select auth.uid(), 'service_close_today', 'service_flags', id, null,
    jsonb_build_object('reason', _reason, 'until', _until)
  from public.service_flags where service_key = _service_key;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_reopen_service_today(_service_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_super_admin();
  update public.service_flags set
    closed_today_date = null, closed_today_reason = null, closed_until = null,
    status_updated_at = now(), status_updated_by = auth.uid()
  where service_key = _service_key;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_set_service_hours_enabled(_service_key text, _enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_super_admin();
  update public.service_flags set hours_enabled = _enabled, status_updated_at = now(), status_updated_by = auth.uid()
  where service_key = _service_key;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  select auth.uid(), 'service_hours_enabled', 'service_flags', id, null,
    jsonb_build_object('hours_enabled', _enabled)
  from public.service_flags where service_key = _service_key;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.staff_set_last_order_buffer(_service_key text, _minutes int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.staff_require_super_admin();
  update public.service_flags set last_order_buffer_minutes = greatest(coalesce(_minutes,0),0),
    status_updated_at = now(), status_updated_by = auth.uid()
  where service_key = _service_key;
  return jsonb_build_object('ok', true);
end $$;

-- ============ Bulk focus + undo ============
create or replace function public.staff_set_service_focus(
  _live_service_key text,
  _message_en text default null, _message_mr text default null,
  _others_status text default 'coming_soon'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _before jsonb; _after jsonb; _token uuid; _expires timestamptz;
  _active jsonb;
begin
  perform public.staff_require_super_admin();
  if _others_status not in ('coming_soon','temporarily_stopped','hidden') then
    raise exception 'Invalid others status';
  end if;
  if not exists (select 1 from public.service_flags where service_key = _live_service_key) then
    raise exception 'Unknown service %', _live_service_key;
  end if;

  -- Pehle active orders ki ginti
  select jsonb_build_object(
    'bookings', (select count(*) from public.bookings
                 where status in ('confirmed','accepted','started','in_progress','on_the_way') and deleted_at is null),
    'parcels', (select count(*) from public.courier_orders
                where status not in ('DELIVERED','COMPLETED','CANCELLED')),
    'merchant_orders', (select count(*) from public.merchant_orders
                where status not in ('delivered','cancelled','completed'))
  ) into _active;

  select jsonb_agg(jsonb_build_object('id', id, 'service_key', service_key, 'status', status,
    'status_message_en', status_message_en, 'status_message_mr', status_message_mr, 'resume_at', resume_at))
  into _before from public.service_flags;

  -- Atomic: ek hi transaction me sab
  update public.service_flags set
    status = case when service_key = _live_service_key then 'live' else _others_status end,
    status_message_en = case when service_key = _live_service_key then status_message_en else coalesce(_message_en, status_message_en) end,
    status_message_mr = case when service_key = _live_service_key then status_message_mr else coalesce(_message_mr, status_message_mr) end,
    resume_at = null,
    status_updated_at = now(), status_updated_by = auth.uid();

  select jsonb_agg(jsonb_build_object('id', id, 'service_key', service_key, 'status', status,
    'status_message_en', status_message_en, 'status_message_mr', status_message_mr, 'resume_at', resume_at))
  into _after from public.service_flags;

  _expires := now() + interval '10 minutes';
  insert into public.service_focus_snapshots (created_by, before, after, active_orders, expires_at)
  values (auth.uid(), _before, _after, _active, _expires)
  returning undo_token into _token;

  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_focus', 'service_flags', null, _before, _after);

  -- Agar focus wali service pehle live nahi thi to waiters ko push
  if exists (select 1 from jsonb_array_elements(_before) b
             where b->>'service_key' = _live_service_key and b->>'status' <> 'live') then
    perform public.notify_service_waiters(_live_service_key);
  end if;

  return jsonb_build_object('ok', true, 'before', _before, 'after', _after,
    'active_orders', _active, 'undo_token', _token, 'undo_expires_at', _expires);
end $$;

create or replace function public.staff_undo_service_focus(_undo_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare snap record; row jsonb; _current jsonb;
begin
  perform public.staff_require_super_admin();
  select * into snap from public.service_focus_snapshots where undo_token = _undo_token;
  if not found then raise exception 'Invalid undo token'; end if;
  if snap.created_by <> auth.uid() then raise exception 'Sirf wahi staff undo kar sakta hai jisne change kiya tha'; end if;
  if snap.used_at is not null then raise exception 'Undo already used'; end if;
  if snap.expires_at < now() then raise exception 'Undo expired'; end if;

  -- Beech me kisi ne status badla? current vs after compare
  select jsonb_agg(jsonb_build_object('id', id, 'status', status))
  into _current from public.service_flags;
  if exists (
    select 1 from jsonb_array_elements(snap.after) a
    join jsonb_array_elements(_current) c on (c->>'id') = (a->>'id')
    where (c->>'status') <> (a->>'status')
  ) then
    raise exception 'Cannot undo: status changed by someone after this action';
  end if;

  for row in select * from jsonb_array_elements(snap.before) loop
    update public.service_flags set
      status = row->>'status',
      status_message_en = nullif(row->>'status_message_en',''),
      status_message_mr = nullif(row->>'status_message_mr',''),
      resume_at = nullif(row->>'resume_at','')::timestamptz,
      status_updated_at = now(), status_updated_by = auth.uid()
    where id = (row->>'id')::uuid;
  end loop;

  update public.service_focus_snapshots set used_at = now() where undo_token = _undo_token;
  insert into public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  values (auth.uid(), 'service_focus_undo', 'service_flags', null, snap.after, snap.before);
  return jsonb_build_object('ok', true);
end $$;

-- Saare staff functions sirf service_role (super_admin check andar hai)
revoke all on function public.staff_set_service_status(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.staff_set_service_hours(text, int, time, time, boolean) from public, anon, authenticated;
revoke all on function public.staff_set_service_holiday(text, date, date, text, text) from public, anon, authenticated;
revoke all on function public.staff_remove_service_holiday(uuid) from public, anon, authenticated;
revoke all on function public.staff_close_service_today(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.staff_reopen_service_today(text) from public, anon, authenticated;
revoke all on function public.staff_set_service_hours_enabled(text, boolean) from public, anon, authenticated;
revoke all on function public.staff_set_last_order_buffer(text, int) from public, anon, authenticated;
revoke all on function public.staff_set_service_focus(text, text, text, text) from public, anon, authenticated;
revoke all on function public.staff_undo_service_focus(uuid) from public, anon, authenticated;
grant execute on function public.staff_set_service_status(text, text, text, text, timestamptz) to service_role;
grant execute on function public.staff_set_service_hours(text, int, time, time, boolean) to service_role;
grant execute on function public.staff_set_service_holiday(text, date, date, text, text) to service_role;
grant execute on function public.staff_remove_service_holiday(uuid) to service_role;
grant execute on function public.staff_close_service_today(text, text, timestamptz) to service_role;
grant execute on function public.staff_reopen_service_today(text) to service_role;
grant execute on function public.staff_set_service_hours_enabled(text, boolean) to service_role;
grant execute on function public.staff_set_last_order_buffer(text, int) to service_role;
grant execute on function public.staff_set_service_focus(text, text, text, text) to service_role;
grant execute on function public.staff_undo_service_focus(uuid) to service_role;

-- ============ Merged expert_set_online (guard + re-broadcast) ============
create or replace function public.rebroadcast_pending_advance_to_expert(_expert_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare b record; _n int := 0; _threshold interval;
begin
  _threshold := make_interval(hours => coalesce(
    nullif((select value from public.ops_settings where key = 'advance_booking_expire_before_slot_hours'), '')::numeric, 2)::int);
  for b in
    select distinct bk.id
    from public.bookings bk
    join public.expert_zones ez on ez.zone_id = bk.zone_id and ez.expert_id = _expert_id
    where bk.status in ('confirmed','accepted')
      and bk.assigned_expert_id is null
      and bk.deleted_at is null
      and bk.broadcast_started_at is not null
      and (bk.last_rebroadcast_at is null or bk.last_rebroadcast_at < now() - interval '30 minutes')
      and public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) is not null
      and public.slot_start_ist(bk.scheduled_date, bk.scheduled_time_slot) > now() + _threshold
    limit 20
  loop
    perform public.broadcast_booking_to_experts(b.id, null);
    perform set_config('app.booking_bypass','on', true);
    update public.bookings set last_rebroadcast_at = now() where id = b.id;
    perform set_config('app.booking_bypass','off', true);
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public.rebroadcast_pending_advance_to_expert(uuid) from public, anon, authenticated;
grant execute on function public.rebroadcast_pending_advance_to_expert(uuid) to service_role;

create or replace function public.expert_set_online(_online boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _expert_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;

  -- (1) Service-hours guard: clean band ho to online nahi (offline jaana kabhi block nahi)
  if coalesce(_online, false)
     and not public.service_can_order('clean', now())
     and not public.service_hours_bypass() then
    raise exception 'SERVICE_CLOSED:%', (public.service_effective_state('clean') ->> 'reason_code');
  end if;

  update public.experts set is_online = coalesce(_online, false) where id = _expert_id;

  -- (2) Online aate hi pending advance bookings dobara offer
  if coalesce(_online, false) then
    perform public.rebroadcast_pending_advance_to_expert(_expert_id);
  end if;
end $$;
