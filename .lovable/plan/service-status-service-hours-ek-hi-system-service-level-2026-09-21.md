# Service Status + Service Hours (ek hi system, service-level)

Scope: sirf service-level (clean, store, courier) — category-level hours **nahi**. Ye hi hours ki ek hi jagah hai; Customer App, Expert App aur Command Center teeno iske hi RPC padhenge.

App 24x7 khula. Availability ek hi jagah se: pehle **status**, phir **hours + holiday**. Sab IST me. Config na ho to service khuli (fail-open).

## 1. Data model + is_active sync rule

`public.service_flags` naye columns:
- `status text NOT NULL DEFAULT 'live' CHECK (status in ('live','coming_soon','temporarily_stopped','hidden'))`
- `status_message_en/mr text` — khaali ho to built-in default
- `resume_at timestamptz`
- `hours_enabled boolean default false`, `closed_today_date date`, `closed_today_reason text`, `closed_until timestamptz` ("kisi time tak" ya "poore din" — dono option)
- `last_order_buffer_minutes int default 0` (Parcel = 30)
- `status_updated_at`, `status_updated_by`

**Backfill + sync rule** (kyunki purana app version sirf `is_active` padhta hai):
- Migration me explicit: `clean` → `status='live'`; **`courier` aur `store` → `status='hidden'`** (is_active ki current value chahe jo bhi ho). Baaki koi future service row: `is_active` se backfill (true → live, false → hidden). Migration ke baad `service_flags` ki poori table (service_key, is_active, status) report me dikhayenge.
- Sync trigger: `status` master hai, `is_active` derived — `status` badalne par `is_active` auto-update (`hidden` → false, baaki teeno → true). Purana app bas `is_active` padhta reh jayega, kabhi takraav nahi.

Child tables:
- `public.service_hours` — `service_flag_id, weekday (0=Sun..6), open_time, close_time, is_closed`. Seed: clean Mon–Sun 09:00–19:00 (baaki jab live hon tab).
- `public.service_holidays` — `service_flag_id (null = sab), start_date, end_date (range), reason, reason_mr`.
- `public.service_hours_bypass_users(user_id)` — seed **phone lookup se** (`+919999900000` ka user dhoondh kar user_id daalega; row na mile to **no-op**, error nahi).
- `public.service_focus_snapshots` — `undo_token, created_by, before jsonb, after jsonb, expires_at, used_at`.

RLS on; SELECT public, writes sirf RPC ke through.

## 2. Status ke 4 states

| Status | Home par dikhe? | Naya order? | Chal rahe orders |
|---|---|---|---|
| Live | haan | haan (hours ke andar) | normal |
| Coming Soon | haan, badge + "Notify me" | nahi | normal |
| Temporarily Stopped | haan, custom message + resume time | nahi | chalte rahenge |
| Hidden | nahi | nahi | chalte rahenge |

`resume_at` beet chuki ho to effective `live`. `resume_at` aaj 7 PM ke baad ho to `next_open_at` = kal 9 AM (test #4). **Hourly** cron data tidy karta hai (`status='live'` likhna) — read-time evaluation se koi cron ki dependency nahi.

## 3. Ek shared function — pehle status, phir hours

`public.service_effective_state(_service_key text, _city text default null, _at timestamptz default now())` → jsonb (`_city` null ho to default **'Latur'**):
```
{ status, visible, can_order, open, reason_code, message_en, message_mr,
  open_time, close_time, last_order_at, next_open_at, resume_at, now_ist }
```
Order: hidden → coming_soon → temporarily_stopped(+resume_at) → holiday (range) → closed_today/closed_until → weekly off → open/close → last-order buffer → live.
Fail-open: row missing, `hours_enabled=false`, ya hours rows na mile → `can_order:true`.

Wrappers: `service_can_order(_key, _at)` boolean; `service_window(_key, _city)`.

Slot parsing: `public.slot_start_ist(_date date, _slot text)` → timestamptz; **slot duration `service_price_options.duration_minutes` se** aayega (hardcode nahi). `slot_end = start + duration`.

Bypass: `service_hours_bypass()` — bypass table user ya `app.booking_bypass` (sirf SECURITY DEFINER server code set karta hai). Customer client par `set_config` se bypass na ho, iska migration-time test: bypass sirf tab maana jayega jab `session_user`/`current_setting('role')` service_role ho — anon/authenticated transaction me bypass ignore.

## 4. Enforcement — sirf NAYE order par

- `bookings_before_insert`: purana logic untouched; shuru me ek block — naya booking ka slot (start + duration) window ke bahar ya status non-live → `RAISE EXCEPTION 'SERVICE_CLOSED:<reason_code>:<next_open_at>'`.
- `create-razorpay-order`: **purpose ke hisaab se** check — sirf `purpose='booking'` (naya booking) aur `purpose='courier'` (naya parcel) par. `extension`, `tip` aur chal rahe order ke kisi bhi payment par **koi check nahi**.
- `courier_create_order` + quote: `service_can_order('courier', now())` (close se 30 min pehle naye order band).
- **Webhook rescue insert (service_role) bypass** — razorpay webhook ka paid-order recovery kabhi block nahi hoga.
- **Paid-but-blocked rule:** agar payment ho gayi ho par order create blocked tha (race), to booking **honor** hogi (rescue insert) — customer ne paise diye hain, order banega; sirf naye requests rokenge. Auto-refund sirf tab jab rescue insert bhi fail ho (existing refund path se).
- Chal rahe orders (dispatch, OTP, complete, refund, cancel, extension, tip): koi check nahi.

## 5. Bulk switch + undo

`staff_set_service_focus(_live_service_key, _message_en, _message_mr, _others_status default 'coming_soon')`
- Sirf **super_admin**, single transaction (atomic).
- **Pehle** active orders ki ginti → return `{ before, after, active_orders, undo_token, undo_expires_at }` + `audit_logs` row.

`staff_undo_service_focus(_undo_token)`
- Sirf usi staff ka, **10 minute** expiry, **ek baar**; beech me kisi aur ne status badla ho to reject.

Roles: saare `staff_set_*` — sirf super_admin via service_role; `revoke EXECUTE from public, anon, authenticated`; fixed `search_path = public`. `service_effective_state/window/can_order` — public read-only.

## 6. Coming Soon — Notify me

- Tile par "Notify me" → `waitlist_requests` (user + service); **login zaroori**, unique constraint se duplicate nahi; dobara tap → "Aap already list me hain".
- Service `live` hone par trigger waitlist users ko `notify_push_event` se **batch me** push queue karega — ek user ko **ek hi baar** (`notified_at` mark), phir list clear/expire.

## 7. App UI (English + Marathi)

- Home: hidden list me nahi; Coming Soon → badge + Notify me; Temporarily Stopped → message + resume time; Live but closed → "Abhi band hai — Kal subah 9 baje se shuru" / holiday par next open date.
- Slot screen: bahar ke slots greyed, "Next available" banner, pehla available highlight. Slot availability me duration `duration_minutes` se (7 PM slot tabhi dikhe jab end 7 PM tak fit ho).
- Parcel: buffer ke baad "Aaj ke parcel orders band" + kal ka open time.
- i18n `serviceState.*` en + mr; DB message pradhan.

## 8. Cache

`["service-state", key]`, staleTime 60s, refetchInterval 60s, focus + resume refresh. `queryPersistence.ts` allow-list me `service-state` nahi jayega (automatic exclude — build me assert se confirm).

## 9. Cron safety

Chal rahe jobs (dispatch, reminders, sweeper, refunds, rewards) me koi check nahi jodega. Ek naya **hourly** job: `resume_at` beet chuki services ko `live` likhna.

## 9a. Advance-booking expiry fix (scheduled_date-aware)

**Abhi ka logic (verified):**
- `auto-expire-unassigned-bookings` cron (har minute) → `system_list_expired_unassigned_bookings()`:
  `status in ('confirmed','accepted') AND assigned_expert_id IS NULL AND deleted_at IS NULL AND COALESCE(broadcast_started_at, created_at) < now() - interval (dispatch_config.no_expert_timeout_minutes, default 30)`.
- **Problem:** `scheduled_date` / slot ka koi dhyan nahi — kal ki advance booking bhi 30 minute me cancel ho jaati hai agar raat ko koi expert online nahi.

**Naya rule:**
- Config key `advance_booking_expire_before_slot_hours` (ops_settings, default `2`).
- Expire condition badal ke: booking tabhi expire ho jab
  `slot_start_ist(scheduled_date, scheduled_time_slot) - now_ist <= advance_booking_expire_before_slot_hours hours` (yaani slot ke 2 ghante andar aa gayi aur abhi bhi expert nahi mila)
  **ya** booking ka slot pehle hi guzar chuka ho.
- Future-scheduled booking jisne slot se pehle hi kuch bhi na dekha ho, wo expiry list me hi nahi aayegi.
- `expand_stale_broadcasts` (30s) bhi same guard lega: advance booking par radius-expand tabhi jab slot threshold ke andar ho — warna raat bhar experts ko bekar ke broadcasts/offers nahi bajenge.

**Subah online aane wale experts — ek hi merged `expert_set_online`:**
Customer App (ye project) aur Expert App project dono ka hook **ek hi function** me merge hoga, taaki dono projects ek doosre ko overwrite na karein. Migration isi project se jayega aur Expert App ke hours-guard ko saath me shaamil karega:

```sql
create or replace function public.expert_set_online(_online boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _expert_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  if _expert_id is null then raise exception 'Not an expert'; end if;

  -- (1) Service-hours guard (Expert App wala hissa): online jaate waqt
  -- clean service band ho aur expert bypass list me na ho → reject.
  -- is_online=false (offline jaana) kabhi block nahi hota.
  if coalesce(_online, false)
     and not (select can_order from public.service_effective_state('clean'))
     and not public.service_hours_bypass() then
    raise exception 'SERVICE_CLOSED:%', (select reason_code from public.service_effective_state('clean'));
  end if;

  update public.experts set is_online = coalesce(_online, false) where id = _expert_id;

  -- (2) Advance-booking re-broadcast (Customer App wala hissa): online aate hi
  -- apne zones ki pending advance bookings dobara offer.
  if coalesce(_online, false) then
    perform public.rebroadcast_pending_advance_to_expert(_expert_id);
  end if;
end $$;
```
- `rebroadcast_pending_advance_to_expert(_expert_id)` (naya, security definer): us expert ke zones ki wo bookings jo `status in ('confirmed','accepted')`, `assigned_expert_id is null`, `deleted_at is null`, slot aaj/future, aur abhi expiry window ke bahar — unhe `broadcast_booking_to_experts` se dobara offer. Throttle: `bookings.last_rebroadcast_at` column se har booking par max 1 re-broadcast per 30 min — ek hi booking har expert ke online hone par baar-baar nahi bajegi.
- Expert App ke auto-offline (after-hours experts ko offline karna) se pehle ye expiry/re-broadcast logic kaam karega — dono independent.

**Rollback SQL** (is fix ka):
```sql
-- ops_settings se key hatao
delete from public.ops_settings where key = 'advance_booking_expire_before_slot_hours';
-- system_list_expired_unassigned_bookings aur expand_stale_broadcasts ke
-- purane version ka poora CREATE OR REPLACE snapshot rollback file me hoga;
-- expert_set_online ke purane version ka bhi.
```

**Tests:**
1. Raat 9 PM par bani kal 10 AM ki booking, sab experts offline → 30+ minute baad **cancel nahi** honi chahiye.
2. Aaj ki instant booking (abhi ke slot ki) → pehle ki tarah 30 minute me expire.
3. Slot se 2 ghante pehle tak koi expert na mile → cancel + refund normal path se.
4. Subah expert online hote hi pending advance booking usko offer ho.

## 10. Rollback SQL

`supabase/service_hours_rollback.sql`: hourly cron unschedule, saare naye functions + 4 tables drop, `service_flags` naye columns drop, sync trigger drop, aur `bookings_before_insert` + `courier_create_order` ke **purane version ka poora CREATE OR REPLACE** snapshot.

## 11. Tests (build ke baad)

1. Non-live par API se seedha booking → reject.
2. Slot parsing: 9 AM allow; **7 PM slot reject** (end > close); "10:00 AM - 12:00 PM" parse; **12 AM/12 PM edge** sahi.
3. **Duration-aware:** 2-hour booking 5 PM start → allow (end 7 PM); 6 PM start → reject; 1-hour booking 6 PM start → allow.
4. `resume_at` aaj 7 PM ke baad → `next_open_at` = kal 9 AM.
5. Holiday (single + range) reject; reviewer bypass skip.
6. Bulk preset atomic + undo (expiry/one-time/state-changed reject).
7. Notify me duplicate nahi; push ek user ek baar.
8. Chal raha order close ke baad bhi complete; extension/tip payment unblock.
9. Webhook rescue insert bypass; paid-but-blocked → booking honor.
10. Fail-open: config row delete → service khuli.
11. **Migration ke baad report:** ek normal booking end-to-end test (create → payment → assign) ka result + `service_flags` ki current values (service_key, is_active, status).

## Rollout order
1. Migration (backfill: is_active → status; courier/store inactive agar DB me inactive hain) — `hours_enabled=false`, kuch nahi badalta.
2. Server enforcement (sirf naye orders) + app UI ship.
3. Command Center se hours on: 9 AM – 7 PM, parcel buffer 30 min.
