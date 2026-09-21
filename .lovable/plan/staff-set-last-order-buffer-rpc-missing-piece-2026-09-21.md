# staff_set_last_order_buffer RPC (missing piece)

Plan me tha par migration me nahi bana. Ek chhota migration jodenge.

## Confirmation: Parcel ka 30-minute default seed NAHI hua

Abhi DB me:

| service_key | status | last_order_buffer_minutes |
|---|---|---|
| clean | live | 0 |
| store | hidden | 0 |
| courier | hidden | 0 |

Yaani courier (Local Parcel) ka buffer abhi **0** hai, 30 nahi. Isi migration me courier ko 30 seed kar denge (baaki services 0 hi rahengi).

## Naya RPC

`public.staff_set_last_order_buffer(_service_key text, _minutes int) returns jsonb`

- `SECURITY DEFINER`, `SET search_path = public` — baaki `staff_set_*` jaisa.
- Sabse pehle `perform public.staff_require_super_admin();` (role check function ke andar).
- Validation: `_minutes` null nahi, aur `0 <= _minutes <= 240`, warna exception.
- Unknown `_service_key` → exception.
- `service_flags.last_order_buffer_minutes` update + `status_updated_at = now()`, `status_updated_by = auth.uid()`.
- `audit_logs` me `action = 'service_buffer_change'`, before/after dono jsonb me.
- Return `{ ok: true, service_key, last_order_buffer_minutes }`.
- Grants: `revoke execute ... from public, anon, authenticated;` — sirf service_role/Command Center path.

## Seed

`update public.service_flags set last_order_buffer_minutes = 30 where service_key = 'courier';`

## Rollback

`supabase/service_hours_rollback.sql` me add: `drop function if exists public.staff_set_last_order_buffer(text, int);` (buffer column already usi file me drop hota hai).

## Asar

Koi app code change nahi — `service_effective_state` pehle se `last_order_buffer_minutes` padhta hai. Courier ka buffer tabhi mehsoos hoga jab `hours_enabled` on karenge.
