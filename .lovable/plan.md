# Service Status + Service Hours (ek hi system)

App 24x7 khula. Har service ki availability ek hi jagah se decide hogi: pehle **status**, uske baad **hours + holiday**. Sab IST me. Config na ho to service khuli (fail-open).

## 1. Ek hi design, ek hi table par anchor

Sab kuch existing `public.service_flags` (clean / store / courier, Latur) par tikta hai. Koi alag parallel flow nahi.

`service_flags` me naye columns:
- `status text default 'live'` — `live | coming_soon | temporarily_stopped | hidden`
  (`is_active` bana rahega backward-compatibility ke liye, status se auto-sync hoga)
- `status_message_en text`, `status_message_mr text` — khaali ho to default message
- `resume_at timestamptz` — is time ke baad service apne aap `live`
- `hours_enabled boolean default false` — false = hours check off (aaj jaisa behaviour)
- `closed_today_date date`, `closed_today_reason text` — "aaj band" override
- `last_order_buffer_minutes int default 0` — close se itni der pehle naye order band (Parcel = 30)
- `status_updated_at`, `status_updated_by`

Do chhote child tables (sirf wahi jo zaroori hain):
- `public.service_hours` — `service_flag_id, weekday (0=Sun..6), open_time, close_time, is_closed`. Seed: teeno services Mon–Sun 09:00–19:00.
- `public.service_holidays` — `service_flag_id (null = sab), holiday_date, reason, reason_mr`.
- `public.service_hours_bypass_users(user_id)` — test + reviewer accounts (`+919999900000` seed).

RLS on; SELECT public (config hai), writes sirf staff/service_role.

## 2. Status ke 4 states ka matlab

| Status | Home par dikhe? | Naya order? | Chal rahe orders |
|---|---|---|---|
| Live | haan | haan (hours ke andar) | normal |
| Coming Soon | haan, "Jald aa raha hai" | nahi | normal |
| Temporarily Stopped | haan, custom message + resume time | nahi | **chalte rahenge** |
| Hidden | nahi dikhe | nahi | chalte rahenge |

- Message: pehle `status_message_en/mr`, khaali ho to built-in default (English + Marathi dono).
- `resume_at` beet gaya ho to effective status `live` mana jayega (koi cron ki zaroorat nahi — read par evaluate). Ek roz ka halka job DB me bhi `status='live'` likh dega taaki Command Center me sahi dikhe.

## 3. Rule: pehle status, phir hours — ek shared function

Ek hi source of truth: `public.service_effective_state(_service_key text, _city text default null, _at timestamptz default now())` → jsonb

```
{
  status: 'live'|'coming_soon'|'temporarily_stopped'|'hidden',
  visible: bool,            // hidden => false
  can_order: bool,          // status live AND hours open AND last-order buffer ke andar
  open: bool,               // sirf hours ka jawab
  reason_code: 'live'|'coming_soon'|'temporarily_stopped'|'hidden'
             |'before_open'|'after_close'|'last_order_passed'|'holiday'|'closed_today'|'weekly_off',
  message_en, message_mr,
  open_time, close_time, last_order_at, next_open_at, resume_at, now_ist
}
```
Order of evaluation: `hidden` → `coming_soon` → `temporarily_stopped` (+resume_at) → holiday → closed_today → weekly off → open/close window → last-order buffer → live & open.
Fail-open: row missing, `hours_enabled=false`, ya hours rows na mile → `can_order:true`.

Patle wrappers (sab isi ko call karein, duplicate logic kahin nahi):
- `public.service_can_order(_key, _at)` boolean — triggers/servers ke liye
- `public.service_window(_key, _city)` — sirf hours/next-open UI ke liye

Bypass: `public.service_hours_bypass()` — bypass table ka user ya `app.booking_bypass` set ho to saare checks skip (test + reviewer account par rok nahi).

## 4. Enforcement (server, IST)

Home services:
- Advance booking 24x7 allowed. Rok sirf **slot** par: slot start >= open_time, slot **end** <= 19:00, holiday/weekly-off/temporarily-stopped dates blocked.
- `bookings_before_insert` me `service_can_order('clean', slot_start)` check → fail par `RAISE EXCEPTION 'SERVICE_CLOSED:<reason_code>:<next_open_at>'`.
- Payment order create (`create-razorpay-order` + booking create server fn) par bhi wahi check → purana app version, deep link, notification tap sab block.

Local Parcel:
- `courier_create_order` aur quote ke shuru me `service_can_order('courier', now())` — close se 30 min pehle hi naye order band.

Chal rahe orders: check sirf **create** par. Dispatch, OTP, complete, refund, cancel sab as-is.

## 5. Bulk switch RPC (atomic)

`public.staff_set_service_focus(_live_service_key text, _message_en text, _message_mr text, _others_status text default 'coming_soon')`
- Sirf **super_admin** (role check; warna `42501`).
- Ek transaction me: sab services ka current state snapshot lo → chuni hui service `live` → baaki sab `_others_status` + message. Aadha lagke ruk nahi sakta (single statement, transaction).
- Return jsonb: `{ before: [...], after: [...], active_orders: { clean: n, store: n, courier: n }, undo_token }`
- **Badalne se pehle** active orders ki ginti (bookings me active statuses, courier_orders me `COURIER_ACTIVE_STATUSES`, merchant_orders pending) return hoti hai taaki Command Center confirm dialog dikha sake.
- `audit_logs` me ek row: action `service_status_bulk_set`, before/after JSON, actor.
- Undo: `public.staff_undo_service_focus(_undo_token uuid)` — audit row ka `before` snapshot wapas apply karta hai (same guards, khud bhi audit hota hai).

## 6. App UI (English + Marathi)

- Home: hidden service list me hi nahi. Coming Soon / Temporarily Stopped par tile greyed + badge aur custom message; Live but closed par "Abhi band hai — Kal subah 9 baje se shuru", holiday par next open date + reason.
- Tap par bottom sheet: message + next available time (`resume_at` ya `next_open_at`), app kahin atakta nahi.
- Slot screen: bahar ke slots greyed, upar "Next available: Kal 9:00 AM" banner, pehla available slot highlight.
- Parcel: buffer ke baad "Aaj ke parcel orders band" + kal ka open time.
- i18n keys `serviceState.*` `src/i18n/en.ts` + `mr.ts` me; DB message ho to wahi jeetta hai.

## 7. Cache

- Query key `["service-state", key]`, staleTime 60s, refetchInterval 60s, window focus + app resume par refresh. Persisted cache me **nahi** (stale open/close galat screen de).
- Client check sirf UX ke liye; asli rok server par.

## 8. Cron safety (live jobs check kiye)

Chal rahe jobs: dispatch-radius-expand (30s), send-completion-reminders, auto-expire-unassigned-bookings, courier-sweeper + refunds, scheduled reminders, reward jobs.
- Inme hours/status check **nahi** jodenge — ye sirf existing orders par kaam karte hain; check jodne se after-hours pending orders galat cancel/fail ho jate.
- Reminders after-hours jaana sahi hai (kal ke slot ka reminder).
- Sirf ek naya halka daily job: `resume_at` beet chuki services ko `status='live'` likhna (read-time evaluation already sahi jawab deta hai, ye sirf data tidy rakhta hai).

## 9. Command Center + Expert App

Read (dono):
- `service_effective_state(_key, _city)` — badge: Live / Coming Soon / Temporarily Stopped / Hidden + "Open till 7 PM".
- `service_hours`, `service_holidays` SELECT.

Command Center writes (staff-only SECURITY DEFINER, sab audited):
- `staff_set_service_status(_key, _status, _message_en, _message_mr, _resume_at)`
- `staff_set_service_focus(...)` + `staff_undo_service_focus(_undo_token)` (super_admin)
- `staff_set_service_hours(_key, _weekday, _open, _close, _is_closed)`
- `staff_set_service_holiday(_key, _date, _reason, _reason_mr)` / `staff_remove_service_holiday(_key, _date)`
- `staff_close_service_today(_key, _reason)` / `staff_reopen_service_today(_key)`
- `staff_set_service_hours_enabled(_key, _enabled)`, `staff_set_last_order_buffer(_key, _minutes)`

Expert App: sirf read (`service_effective_state`) — aaj ka open/close + holiday banner. Expert side par koi rok nahi; chal rahe orders normal.

## 10. Rollback SQL

`supabase/service_hours_rollback.sql`:
```sql
select cron.unschedule('service-resume-at-sync');

drop function if exists public.service_effective_state(text, text, timestamptz);
drop function if exists public.service_can_order(text, timestamptz);
drop function if exists public.service_window(text, text);
drop function if exists public.service_hours_bypass();
drop function if exists public.staff_set_service_status(text, text, text, text, timestamptz);
drop function if exists public.staff_set_service_focus(text, text, text, text);
drop function if exists public.staff_undo_service_focus(uuid);
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
  drop column if exists status,
  drop column if exists status_message_en,
  drop column if exists status_message_mr,
  drop column if exists resume_at,
  drop column if exists status_updated_at,
  drop column if exists status_updated_by,
  drop column if exists hours_enabled,
  drop column if exists closed_today_date,
  drop column if exists closed_today_reason,
  drop column if exists last_order_buffer_minutes;

-- rollback file me bookings_before_insert aur courier_create_order ke
-- purane version ka pura CREATE OR REPLACE snapshot bhi rahega.
```

## Rollout order
1. Migration (columns + tables + functions), `status='live'`, `hours_enabled=false` — kuch nahi badalta.
2. Server enforcement + app UI ship.
3. Command Center se hours on: 9 AM – 7 PM, parcel buffer 30 min.
