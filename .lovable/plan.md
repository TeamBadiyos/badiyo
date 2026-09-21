# Service Status + Service Hours (ek hi system, service-level)

Scope: sirf service-level (clean, store, courier) — category-level hours **nahi**. Ye hi hours ki ek hi jagah hai; Customer App, Expert App aur Command Center teeno iske hi RPC padhenge.

App 24x7 khula. Har service ki availability ek hi jagah se: pehle **status**, uske baad **hours + holiday**. Sab IST me. Config na ho to service khuli (fail-open).

## 1. Data model

Sab kuch existing `public.service_flags` par. Naye columns:
- `status text NOT NULL DEFAULT 'live' CHECK (status in ('live','coming_soon','temporarily_stopped','hidden'))`
- `status_message_en text`, `status_message_mr text` — khaali ho to built-in default
- `resume_at timestamptz` — iske baad effective status `live`
- `hours_enabled boolean default false`, `closed_today_date date`, `closed_today_reason text`,
  `closed_until timestamptz` — "aaj band" me option: kisi time tak **ya** poore din
- `last_order_buffer_minutes int default 0` (Parcel = 30)
- `status_updated_at`, `status_updated_by`

Child tables:
- `public.service_hours` — `service_flag_id, weekday (0=Sun..6), open_time, close_time, is_closed`. Seed: teeno services Mon–Sun 09:00–19:00.
- `public.service_holidays` — `service_flag_id (null = sab), start_date, end_date (date range), reason, reason_mr`.
- `public.service_hours_bypass_users(user_id)` — test + reviewer (`+919999900000` seed).
- Undo ke liye `public.service_focus_snapshots` — `undo_token uuid, created_by, before jsonb, after jsonb, expires_at, used_at`.

RLS on; SELECT public (config hai), writes sirf service_role/RPC ke through.

## 2. Status ke 4 states

| Status | Home par dikhe? | Naya order? | Chal rahe orders |
|---|---|---|---|
| Live | haan | haan (hours ke andar) | normal |
| Coming Soon | haan, badge + "Notify me" | nahi | normal |
| Temporarily Stopped | haan, custom message + resume time | nahi | chalte rahenge |
| Hidden | nahi | nahi | chalte rahenge |

`resume_at` beet chuki ho to effective status `live` (read-time evaluation). **Note:** agar `resume_at` aaj 7 PM ke baad ka hai, to `next_open_at` kal 9 AM dikhayega (status live, par hours band) — test #4 me covered. Ek roz ka halka cron `status='live'` likh dega data tidy rakhne ke liye.

## 3. Ek shared function — pehle status, phir hours

`public.service_effective_state(_service_key text, _city text default null, _at timestamptz default now())` → jsonb:
```
{ status, visible, can_order, open,
  reason_code: 'live'|'coming_soon'|'temporarily_stopped'|'hidden'
             |'before_open'|'after_close'|'last_order_passed'
             |'holiday'|'closed_today'|'closed_until'|'weekly_off',
  message_en, message_mr,
  open_time, close_time, last_order_at, next_open_at, resume_at, now_ist }
```
Order: `hidden` → `coming_soon` → `temporarily_stopped`(+resume_at) → holiday (date range) → closed_today/closed_until → weekly off → open/close → last-order buffer → live.
Fail-open: row missing, `hours_enabled=false`, ya hours rows na mile → `can_order:true`.

Wrappers (duplicate logic kahin nahi):
- `public.service_can_order(_key, _at)` boolean
- `public.service_window(_key, _city)` — hours/next-open UI ke liye

Slot parsing (shared, sab jagah ek hi):
- `public.slot_start_ist(_date date, _slot text)` → timestamptz (IST). "10:00 AM - 12:00 PM" jaise format ka start nikalta hai, slot **end** = start + duration.
- `bookings_before_insert` isi ko use karega; frontend sirf display ke liye.

Bypass: `public.service_hours_bypass()` — bypass table ka user ho ya DB me `app.booking_bypass` set ho (sirf SECURITY DEFINER server code hi set karta hai; **customer client ye setting set nahi kar sakta** — migration me confirm test karenge ki anon/authenticated role par `set_config('app.booking_bypass',...)` koi trigger-check bypass na kar sake, kyunki trigger me bypass sirf tab maana jayega jab caller service_role ho — client transaction me ye guard enforce karenge).

## 4. Enforcement (server, IST)

- `bookings_before_insert`: **purana logic bilkul untouched**; sirf shuru me ek block jude — status live nahi, ya slot (start+end) window ke bahar → `RAISE EXCEPTION 'SERVICE_CLOSED:<reason_code>:<next_open_at>'`. Bypass users exempt. **Rollback file me is function ka poora purana CREATE OR REPLACE snapshot rahega.** Migration ke baad ek normal booking test: create → payment → assign.
- Payment order create (`create-razorpay-order` + booking server fn) par wahi check → purana app version / deep link / notification tap sab block.
- `courier_create_order` + quote ke shuru me `service_can_order('courier', now())` (close se 30 min pehle naye order band).
- Chal rahe orders par koi check nahi — dispatch/OTP/complete/refund/cancel as-is.

## 5. Bulk switch + undo

`public.staff_set_service_focus(_live_service_key, _message_en, _message_mr, _others_status text default 'coming_soon')`
- Sirf **super_admin**; **atomic** single transaction (aadha lag ke nahi rukega).
- Return: `{ before, after, active_orders: {clean, store, courier}, undo_token, undo_expires_at }` — **active orders ki ginti badalne se pehle** li jayegi.
- `audit_logs` me before/after + actor.

`public.staff_undo_service_focus(_undo_token uuid)`
- Token sirf **usi staff** ka, **10 minute** me expire, **ek hi baar** (`used_at` mark).
- Beech me kisi aur ne kisi service ka status badla ho to current state snapshot se compare karke **reject** ("state changed since then").

Saare `staff_set_*` functions ke roles:
| Function | Kaun chala sakta |
|---|---|
| `staff_set_service_focus`, `staff_undo_service_focus`, `staff_set_service_status`, `staff_set_service_hours`, `staff_set_service_holiday`, `staff_remove_service_holiday`, `staff_close_service_today`, `staff_reopen_service_today`, `staff_set_service_hours_enabled`, `staff_set_last_order_buffer` | sirf super_admin (service_role ke through) |
| `service_effective_state`, `service_window`, `service_can_order` | public read (anon + authenticated) — sirf read |

Sab par: `EXECUTE revoke from public, anon, authenticated` (staff fns), `set search_path = public` fixed, role check function ke andar bhi.

## 6. Coming Soon — Notify me

- Tile par "Notify me" button → existing `waitlist_requests` me row (user + service). Unique constraint se **duplicate nahi** banega; dobara tap par "Aap already list me hain".
- Service live hone par: `staff_set_service_status` → `live` hone par trigger waitlist ke users ko push notification queue karega (existing `notify_push_event` rasta), phir rows notify-mark.

## 7. App UI (English + Marathi)

- Home: hidden service list me nahi; Coming Soon → badge + Notify me; Temporarily Stopped → custom message + resume time; Live but closed → "Abhi band hai — Kal subah 9 baje se shuru" (holiday par next open date + reason).
- Tap par bottom sheet, app kahin nahi rukta.
- Slot screen: bahar ke slots greyed, "Next available: Kal 9:00 AM" banner, pehla available slot highlight.
- Parcel: buffer ke baad "Aaj ke parcel orders band" + kal ka open time.
- i18n keys `serviceState.*` en + mr; DB message ho to wahi jeetta hai.

## 8. Cache

- Query key `["service-state", key]`, staleTime 60s, refetchInterval 60s, focus + resume par refresh.
- `queryPersistence.ts` ki `PERSISTED_KEYS` me `service-state` **nahi** jayega (wo list allow-list hai, isliye exclude automatic — build me ek test/assert se confirm karenge). Client check sirf UX; asli rok server par.

## 9. Cron safety

Chal rahe jobs (dispatch, reminders, sweeper, refunds, rewards) me koi status/hours check **nahi** jodega — wo existing orders par kaam karte hain, check jodne se galat cancel/fail hota. Sirf ek naya daily job: `resume_at` beet chuki services ko `live` likhna.

## 10. Rollback SQL

`supabase/service_hours_rollback.sql`: cron unschedule, saare naye functions drop, 4 naye tables drop, `service_flags` ke saare naye columns drop, aur `bookings_before_insert` + `courier_create_order` ke **purane version ka poora CREATE OR REPLACE** snapshot.

## 11. Tests (build ke baad chalenge)

1. Non-live status par API se seedha booking → reject.
2. Hours ke andar slot → allow; 9 AM slot allow, **7 PM slot reject** (end 8 PM > close), "10:00 AM - 12:00 PM" format parse, **12 AM / 12 PM edge** parse sahi.
3. Holiday (single date + date range) par reject.
4. `resume_at` aaj 7 PM ke baad → `next_open_at` = kal 9 AM.
5. Reviewer allowlist (`+919999900000`) par saare checks skip.
6. Bulk preset atomic (beech me failure par kuch na badle) + undo (expiry, one-time, state-changed reject).
7. Notify me duplicate → doosri row nahi.
8. Chal raha order close time ke baad bhi normally complete ho.
9. Fail-open: config row delete kar do to service khuli rahe.
10. Migration ke baad normal booking end-to-end (create → payment → assign).

## Rollout order
1. Migration (columns + tables + functions), `status='live'`, `hours_enabled=false` — kuch nahi badalta.
2. Server enforcement + app UI ship.
3. Command Center se hours on: 9 AM – 7 PM, parcel buffer 30 min.
