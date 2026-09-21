
-- ============ 1. service_flags columns ============
alter table public.service_flags
  add column if not exists status text not null default 'live',
  add column if not exists status_message_en text,
  add column if not exists status_message_mr text,
  add column if not exists resume_at timestamptz,
  add column if not exists hours_enabled boolean not null default false,
  add column if not exists closed_today_date date,
  add column if not exists closed_today_reason text,
  add column if not exists closed_until timestamptz,
  add column if not exists last_order_buffer_minutes int not null default 0,
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'service_flags_status_check') then
    alter table public.service_flags
      add constraint service_flags_status_check
      check (status in ('live','coming_soon','temporarily_stopped','hidden'));
  end if;
end $$;

-- Backfill: clean live, courier + store explicitly hidden, rest from is_active
update public.service_flags set status = 'live', status_updated_at = now() where service_key = 'clean';
update public.service_flags set status = 'hidden', status_updated_at = now() where service_key in ('courier','store');
update public.service_flags set status = case when is_active then 'live' else 'hidden' end, status_updated_at = now()
 where service_key not in ('clean','courier','store');

-- Sync trigger: status is master, is_active derived; direct is_active edits also sync status
create or replace function public.service_flags_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      new.is_active := (new.status <> 'hidden');
    elsif new.is_active is distinct from old.is_active then
      new.status := case when new.is_active then 'live' else 'hidden' end;
    end if;
  else
    new.is_active := (new.status <> 'hidden');
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_service_flags_sync on public.service_flags;
create trigger trg_service_flags_sync before insert or update on public.service_flags
  for each row execute function public.service_flags_sync();

-- ============ 2. Child tables ============
create table if not exists public.service_hours (
  id uuid primary key default gen_random_uuid(),
  service_flag_id uuid not null references public.service_flags(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  open_time time not null default '09:00',
  close_time time not null default '19:00',
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_flag_id, weekday)
);
grant select on public.service_hours to anon, authenticated;
grant all on public.service_hours to service_role;
alter table public.service_hours enable row level security;
create policy "service_hours public read" on public.service_hours for select to anon, authenticated using (true);

create table if not exists public.service_holidays (
  id uuid primary key default gen_random_uuid(),
  service_flag_id uuid references public.service_flags(id) on delete cascade,
  start_date date not null,
  end_date date,
  reason text,
  reason_mr text,
  created_at timestamptz not null default now()
);
grant select on public.service_holidays to anon, authenticated;
grant all on public.service_holidays to service_role;
alter table public.service_holidays enable row level security;
create policy "service_holidays public read" on public.service_holidays for select to anon, authenticated using (true);

create table if not exists public.service_hours_bypass_users (
  user_id uuid primary key,
  note text,
  created_at timestamptz not null default now()
);
grant all on public.service_hours_bypass_users to service_role;
alter table public.service_hours_bypass_users enable row level security;

create table if not exists public.service_focus_snapshots (
  undo_token uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  before jsonb not null,
  after jsonb not null,
  active_orders jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
grant all on public.service_focus_snapshots to service_role;
alter table public.service_focus_snapshots enable row level security;

create table if not exists public.service_notify_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  service_key text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (user_id, service_key)
);
grant select, insert on public.service_notify_requests to authenticated;
grant all on public.service_notify_requests to service_role;
alter table public.service_notify_requests enable row level security;
create policy "users manage own notify requests" on public.service_notify_requests
  for select to authenticated using (auth.uid() = user_id);
create policy "users insert own notify requests" on public.service_notify_requests
  for insert to authenticated with check (auth.uid() = user_id);

-- bookings: re-broadcast throttle marker
alter table public.bookings add column if not exists last_rebroadcast_at timestamptz;

-- Seeds: clean Mon-Sun 09:00-19:00; reviewer bypass (phone lookup, no-op if missing)
insert into public.service_hours (service_flag_id, weekday, open_time, close_time, is_closed)
select f.id, d, '09:00'::time, '19:00'::time, false
from public.service_flags f cross join generate_series(0,6) d
where f.service_key = 'clean'
on conflict (service_flag_id, weekday) do nothing;

insert into public.service_hours_bypass_users (user_id, note)
select id, 'reviewer allowlist' from public.users where phone like '%9999900000'
on conflict (user_id) do nothing;

insert into public.ops_settings (key, value, label)
values ('advance_booking_expire_before_slot_hours', '2', 'Advance booking expires only within N hours of slot start')
on conflict (key) do nothing;

-- ============ 3. Core shared functions ============

-- Slot text ("10:00 AM - 12:00 PM") ka start -> IST timestamp
create or replace function public.slot_start_ist(_date date, _slot text)
returns timestamptz language plpgsql stable set search_path = public as $$
declare m text[]; h int; mi int; ap text;
begin
  if _date is null or _slot is null then return null; end if;
  m := regexp_match(_slot, '(\d{1,2}):(\d{2})\s*([AaPp][Mm])');
  if m is null then return null; end if;
  h := m[1]::int; mi := m[2]::int; ap := upper(m[3]);
  if ap = 'PM' and h < 12 then h := h + 12; end if;
  if ap = 'AM' and h = 12 then h := 0; end if;
  if h > 23 or mi > 59 then return null; end if;
  return ((_date::text || ' ' || lpad(h::text, 2, '0') || ':' || lpad(mi::text, 2, '0') || ':00+05:30')::timestamptz);
end $$;

-- Bypass: allowlist user YA service_role transaction with app.booking_bypass=on
create or replace function public.service_hours_bypass()
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and exists (select 1 from public.service_hours_bypass_users where user_id = auth.uid()) then
    return true;
  end if;
  if coalesce(current_setting('app.booking_bypass', true), '') = 'on'
     and coalesce(current_setting('role', true), '') = 'service_role' then
    return true;
  end if;
  return false;
end $$;

-- Next open scan helper
create or replace function public.service_next_open(_flag_id uuid, _from timestamptz)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  i int; d date; dw int; hr record; cand timestamptz;
  _closed_date date; _closed_until timestamptz;
begin
  select closed_today_date, closed_until into _closed_date, _closed_until
    from public.service_flags where id = _flag_id;
  for i in 0..9 loop
    d := (_from at time zone 'Asia/Kolkata')::date + i;
    dw := extract(dow from d)::int;
    -- holiday skip
    if exists (select 1 from public.service_holidays h
               where (h.service_flag_id = _flag_id or h.service_flag_id is null)
                 and d between h.start_date and coalesce(h.end_date, h.start_date)) then
      continue;
    end if;
    -- closed-today skip (sirf us din)
    if _closed_date = d then
      if _closed_until is not null and _closed_until > _from
         and _closed_until::timestamptz at time zone 'Asia/Kolkata' ::date = d then
        return _closed_until;
      end if;
      continue;
    end if;
    select * into hr from public.service_hours
     where service_flag_id = _flag_id and weekday = dw;
    if not found or hr.is_closed then continue; end if;
    cand := ((d::text || ' ' || hr.open_time::text || '+05:30')::timestamptz);
    if cand > _from then return cand; end if;
    -- same day: open already passed, par close abhi baaki ho to "abhi" nahi — caller handles
  end loop;
  return null;
end $$;

-- Single source of truth: pehle status, phir hours + holiday (IST)
create or replace function public.service_effective_state(_service_key text, _city text default null, _at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f record; st text; visible boolean;
  ldate date; ltime time; ldow int;
  hr record; hol record;
  open_dt timestamptz; close_dt timestamptz; last_order timestamptz;
  next_open timestamptz; reason text; msg_en text; msg_mr text;
  can_order boolean; is_open boolean;
begin
  select * into f from public.service_flags
   where service_key = _service_key and city = coalesce(_city, 'Latur')
   order by created_at limit 1;
  if not found then
    return jsonb_build_object('status','live','visible',true,'can_order',true,'open',true,
      'reason_code','no_config','now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;

  st := f.status;
  if st = 'temporarily_stopped' and f.resume_at is not null and f.resume_at <= _at then
    st := 'live';
  end if;
  visible := st <> 'hidden';
  msg_en := f.status_message_en; msg_mr := f.status_message_mr;

  if st <> 'live' then
    return jsonb_build_object('status', st, 'visible', visible, 'can_order', false, 'open', false,
      'reason_code', st, 'message_en', msg_en, 'message_mr', msg_mr,
      'resume_at', f.resume_at, 'now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;

  -- status live: hours check
  if not coalesce(f.hours_enabled, false) then
    return jsonb_build_object('status','live','visible',true,'can_order',true,'open',true,
      'reason_code','live','now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;

  ldate := (_at at time zone 'Asia/Kolkata')::date;
  ltime := (_at at time zone 'Asia/Kolkata')::time;
  ldow := extract(dow from (_at at time zone 'Asia/Kolkata'))::int;

  -- holiday (range)
  select * into hol from public.service_holidays h
   where (h.service_flag_id = f.id or h.service_flag_id is null)
     and ldate between h.start_date and coalesce(h.end_date, h.start_date)
   limit 1;
  if found then
    next_open := public.service_next_open(f.id, _at);
    return jsonb_build_object('status','live','visible',true,'can_order',false,'open',false,
      'reason_code','holiday',
      'message_en', coalesce(hol.reason, msg_en), 'message_mr', coalesce(hol.reason_mr, msg_mr),
      'next_open_at', next_open, 'now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;

  -- closed today (time tak ya poore din)
  if f.closed_today_date = ldate then
    if f.closed_until is not null and f.closed_until > _at then
      return jsonb_build_object('status','live','visible',true,'can_order',false,'open',false,
        'reason_code','closed_until',
        'message_en', coalesce(f.closed_today_reason, msg_en), 'message_mr', msg_mr,
        'next_open_at', f.closed_until, 'now_ist', (_at at time zone 'Asia/Kolkata'));
    elsif f.closed_until is null then
      next_open := public.service_next_open(f.id, _at);
      return jsonb_build_object('status','live','visible',true,'can_order',false,'open',false,
        'reason_code','closed_today',
        'message_en', coalesce(f.closed_today_reason, msg_en), 'message_mr', msg_mr,
        'next_open_at', next_open, 'now_ist', (_at at time zone 'Asia/Kolkata'));
    end if;
  end if;

  -- weekly hours
  select * into hr from public.service_hours where service_flag_id = f.id and weekday = ldow;
  if not found then
    -- fail-open
    return jsonb_build_object('status','live','visible',true,'can_order',true,'open',true,
      'reason_code','live','now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;
  if hr.is_closed then
    next_open := public.service_next_open(f.id, _at);
    return jsonb_build_object('status','live','visible',true,'can_order',false,'open',false,
      'reason_code','weekly_off','next_open_at', next_open, 'now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;

  open_dt := ((ldate::text || ' ' || hr.open_time::text || '+05:30')::timestamptz);
  close_dt := ((ldate::text || ' ' || hr.close_time::text || '+05:30')::timestamptz);
  last_order := close_dt - make_interval(mins => greatest(coalesce(f.last_order_buffer_minutes,0),0));

  if ltime < hr.open_time then
    return jsonb_build_object('status','live','visible',true,'can_order',false,'open',false,
      'reason_code','before_open','open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', open_dt, 'now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;
  if ltime >= hr.close_time then
    next_open := public.service_next_open(f.id, _at);
    return jsonb_build_object('status','live','visible',true,'can_order',false,'open',false,
      'reason_code','after_close','open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', next_open, 'now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;
  if coalesce(f.last_order_buffer_minutes,0) > 0 and ltime >= (hr.close_time - make_interval(mins => f.last_order_buffer_minutes))::time then
    return jsonb_build_object('status','live','visible',true,'can_order',false,'open',true,
      'reason_code','last_order_passed','open_time', hr.open_time, 'close_time', hr.close_time,
      'last_order_at', last_order,
      'next_open_at', public.service_next_open(f.id, close_dt),
      'now_ist', (_at at time zone 'Asia/Kolkata'));
  end if;

  return jsonb_build_object('status','live','visible',true,'can_order',true,'open',true,
    'reason_code','live','open_time', hr.open_time, 'close_time', hr.close_time,
    'last_order_at', last_order, 'now_ist', (_at at time zone 'Asia/Kolkata'));
end $$;

create or replace function public.service_can_order(_service_key text, _at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((public.service_effective_state(_service_key, null, _at)->>'can_order')::boolean, true);
end $$;

create or replace function public.service_window(_service_key text, _city text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st jsonb;
begin
  st := public.service_effective_state(_service_key, _city, now());
  return jsonb_build_object(
    'status', st->>'status', 'visible', st->'visible', 'can_order', st->'can_order',
    'open', st->'open', 'reason_code', st->>'reason_code',
    'message_en', st->>'message_en', 'message_mr', st->>'message_mr',
    'open_time', st->>'open_time', 'close_time', st->>'close_time',
    'last_order_at', st->>'last_order_at', 'next_open_at', st->>'next_open_at',
    'resume_at', st->>'resume_at');
end $$;

-- Ek slot (date + slot text + duration) window ke andar hai ya nahi
create or replace function public.service_slot_allowed(_service_key text, _date date, _slot text, _duration_minutes int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  st jsonb; f record; start_at timestamptz; end_at timestamptz;
  ldate date; ldow int; hr record; start_t time; end_t time;
begin
  st := public.service_effective_state(_service_key, null, now());
  if (st->>'status') <> 'live' then
    return jsonb_build_object('ok', false, 'reason_code', st->>'reason_code',
      'next_open_at', st->>'next_open_at', 'resume_at', st->>'resume_at');
  end if;
  select * into f from public.service_flags
   where service_key = _service_key and city = 'Latur' order by created_at limit 1;
  if not found or not coalesce(f.hours_enabled, false) then
    return jsonb_build_object('ok', true, 'reason_code', 'live');
  end if;

  start_at := public.slot_start_ist(_date, _slot);
  if start_at is null then start_at := now(); end if; -- instant booking
  end_at := start_at + make_interval(mins => greatest(coalesce(_duration_minutes, 60), 1));

  if start_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason_code', 'slot_passed');
  end if;

  ldate := (start_at at time zone 'Asia/Kolkata')::date;
  ldow := extract(dow from (start_at at time zone 'Asia/Kolkata'))::int;
  start_t := (start_at at time zone 'Asia/Kolkata')::time;
  end_t := (end_at at time zone 'Asia/Kolkata')::time;

  -- holiday on slot date
  if exists (select 1 from public.service_holidays h
             where (h.service_flag_id = f.id or h.service_flag_id is null)
               and ldate between h.start_date and coalesce(h.end_date, h.start_date)) then
    return jsonb_build_object('ok', false, 'reason_code', 'holiday',
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  -- closed today on slot date
  if f.closed_today_date = ldate and (f.closed_until is null or f.closed_until > start_at) then
    return jsonb_build_object('ok', false, 'reason_code', 'closed_today',
      'next_open_at', coalesce(f.closed_until, public.service_next_open(f.id, start_at)));
  end if;

  select * into hr from public.service_hours where service_flag_id = f.id and weekday = ldow;
  if not found then
    return jsonb_build_object('ok', true, 'reason_code', 'live'); -- fail-open
  end if;
  if hr.is_closed then
    return jsonb_build_object('ok', false, 'reason_code', 'weekly_off',
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  if start_t < hr.open_time or end_t > hr.close_time then
    return jsonb_build_object('ok', false, 'reason_code', 'outside_hours',
      'open_time', hr.open_time, 'close_time', hr.close_time,
      'next_open_at', public.service_next_open(f.id, start_at));
  end if;
  return jsonb_build_object('ok', true, 'reason_code', 'live');
end $$;

-- Grants: read functions public, helper authenticated
revoke all on function public.service_hours_bypass() from public, anon;
grant execute on function public.service_hours_bypass() to authenticated, service_role;
grant execute on function public.slot_start_ist(date, text) to anon, authenticated, service_role;
grant execute on function public.service_effective_state(text, text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.service_can_order(text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.service_window(text, text) to anon, authenticated, service_role;
grant execute on function public.service_slot_allowed(text, date, text, int) to authenticated, service_role;
revoke all on function public.service_next_open(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.service_next_open(uuid, timestamptz) to service_role;
