# Service Hours System (9 AM – 7 PM IST, per-service)

App 24x7 open rahega. Sirf ordering/slot booking service hours ke andar. Sab kuch IST me evaluate hoga, aur config missing ho to service khuli (fail-open).

## 1. Data model (service_flags extend + 2 chhote tables)

`service_flags` already exists (clean / store / courier, Latur, is_active). Usi ko hours ka anchor banate hain:

New columns on `public.service_flags`:
- `hours_enabled boolean default false` — jab tak false, service hamesha khuli (fail-open, aaj ka behaviour badalta nahi)
- `closed_today_date date` — "aaj band" override (ek tap se aaj ke liye band)
- `closed_today_reason text`
- `last_order_buffer_minutes int default 0` — close se kitni der pehle naya order band (Parcel = 30)

New table `public.service_hours` (weekday-wise, per service_flag):
- `service_flag_id`, `weekday smallint (0=Sunday..6)`, `open_time time`, `close_time time`, `is_closed boolean`
- Default seed: clean/store/courier → Mon–Sun 09:00–19:00

New table `public.service_holidays`:
- `service_flag_id` (null = sab services), `holiday_date date`, `reason text`, `reason_mr text`

Grants: `anon`/`authenticated` ko SELECT (public config), likhna sirf staff/service_role. RLS on, read policies public.

## 2. Ek hi sach ka source: RPC

`public.service_window(_service_key text, _city text default null)` → jsonb:
```
{ open: true/false, now_ist, open_time, close_time,
  last_order_at,            // close - buffer
  next_open_at,             // kal 9 AM ya holiday ke baad agli open date
  closed_reason, closed_reason_mr,
  reason_code: 'open'|'before_open'|'after_close'|'holiday'|'closed_today'|'weekly_off'|'service_off' }
```
- Sab time math `timezone('Asia/Kolkata', now())` par.
- `hours_enabled=false` ya koi row na mile → `open:true` (fail-open).
- Helper `public.service_is_open(_key, _at timestamptz default now())` boolean — triggers isi ko call karenge.

Bypass: `public.service_hours_bypass()` — true jab caller reviewer/test account ho. Naya table `service_hours_bypass_users(user_id)` + reviewer phone `+919999900000` seed. Bypass hone par saare checks skip.

## 3. Enforcement (server, IST)

Home services:
- Advance booking 24x7 allowed. Restriction sirf **slot** par: slot start >= open_time aur slot **end** <= 19:00 (close), holiday/weekly-off dates block.
- `bookings_before_insert` me check add: chosen slot date+time service window ke andar hai? nahi → `RAISE EXCEPTION 'SERVICE_CLOSED:<next_open_at>'`. `app.booking_bypass` aur bypass users exempt.
- Payment order create (`create-razorpay-order` + booking create server fn) me same check — purana app version / deep link / notification tap se bhi block ho jayega.

Local Parcel (courier):
- Naya order sirf abhi-open window me. `courier_create_order` ki shuruaat me `service_is_open('courier')` + `now_ist <= last_order_at (close - 30 min)` check; fail → friendly error.
- Quote bhi band hone par error de (customer ko payment tak pahunchne hi na de).

Chal rahe orders: koi bhi close check sirf **create** par. Dispatch, OTP, complete, refund, cancel — sab as-is chalte rahenge.

## 4. App UI (English + Marathi)

- Home: har service tile par band hone par overlay/badge "Abhi band hai" + line: "Kal subah 9 baje se shuru" / holiday par "Soma, 2 Oct se shuru — Gandhi Jayanti". Tile tap → disabled with same message sheet (app khula rehta hai).
- Slot screen: closed hours wale slots greyed; upar banner "Next available: Kal 9:00 AM" aur pehla available slot auto-highlight.
- Parcel screen: close se 30 min pehle "Aaj ke orders band" + next open time.
- i18n keys `hours.*` `src/i18n/en.ts` + `mr.ts` me.

## 5. Cache

- React Query key `["service-window", key]`, `staleTime` 60s, `refetchInterval` 60s, `refetchOnWindowFocus` + app resume par refresh. Persisted cache me **nahi** rakhenge (stale open/close se galat screen).
- Booking/parcel confirm karte waqt client check sirf UX; asli rok server par.

## 6. Cron safety review (already checked)

Live jobs: dispatch-radius-expand (30s), send-completion-reminders, auto-expire-unassigned-bookings, courier-sweeper + refunds, reminders, reward jobs.
- Ye sab **existing** orders par kaam karte hain — inme koi hours check nahi jodenge, warna after-hours pending orders galat cancel/fail ho jayenge.
- Ek fix: `auto-expire-unassigned-bookings` aur `courier_search_timeout` ka timer service close hone par bhi chalta rahega — next-day slots wali bookings par ye already lagu nahi hota, confirm karke rakhenge as-is.
- Reminders after-hours bhej sakte hain (ye sahi hai — customer ko kal ke slot ka reminder chahiye). Koi naya cron nahi chahiye.

## 7. Command Center + Expert App ko kya chahiye

Read:
- `service_window(_key, _city)` — dono apps ke liye same RPC (badge "Open till 7 PM" / "Closed").
- `service_hours` + `service_holidays` SELECT.

Command Center writes (naye staff-only RPCs, SECURITY DEFINER + staff role check):
- `staff_set_service_hours(_service_key, _weekday, _open, _close, _is_closed)`
- `staff_set_service_holiday(_service_key, _date, _reason, _reason_mr)` / `staff_remove_service_holiday(...)`
- `staff_close_service_today(_service_key, _reason)` / `staff_reopen_service_today(_service_key)`
- `staff_set_service_hours_enabled(_service_key, _enabled)` aur `staff_set_last_order_buffer(_service_key, _minutes)`

Expert App: sirf padhne ke liye `service_window` (aaj ka open/close + "aaj holiday hai" banner). Koi enforcement expert side par nahi — chal rahe orders normal.

## 8. Rollback SQL

Plan ke saath ek `supabase/service_hours_rollback.sql` file di jayegi:
```sql
drop function if exists public.service_window(text, text);
drop function if exists public.service_is_open(text, timestamptz);
drop function if exists public.service_hours_bypass();
drop function if exists public.staff_set_service_hours(text, smallint, time, time, boolean);
drop function if exists public.staff_set_service_holiday(text, date, text, text);
drop function if exists public.staff_remove_service_holiday(text, date);
drop function if exists public.staff_close_service_today(text, text);
drop function if exists public.staff_reopen_service_today(text);
drop function if exists public.staff_set_service_hours_enabled(text, boolean);
drop function if exists public.staff_set_last_order_buffer(text, int);
drop table if exists public.service_hours;
drop table if exists public.service_holidays;
drop table if exists public.service_hours_bypass_users;
alter table public.service_flags
  drop column if exists hours_enabled,
  drop column if exists closed_today_date,
  drop column if exists closed_today_reason,
  drop column if exists last_order_buffer_minutes;
-- plus: bookings_before_insert aur courier_create_order ko purane version par restore
--       (rollback file me dono ka pura CREATE OR REPLACE snapshot rahega)
```

## Rollout order
1. Migration (tables + columns + RPCs), `hours_enabled=false` — kuch nahi badalta.
2. Server enforcement + app UI ship.
3. Command Center se clean/store/courier par `hours_enabled=true`, 9–7, parcel buffer 30 min.
