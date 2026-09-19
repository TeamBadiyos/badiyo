# Admin WhatsApp alert on new paid order (temporary)

Ek chhota, alag-thalag alert system: jab bhi koi order ka payment confirm ho, aapke personal WhatsApp par ek short message jaaye. Existing booking, payment ya courier ka koi bhi logic nahi badlega — sirf naya queue + naya route add hoga, aur sab kuch ek migration se hata bhi sakte hain.

## Kaise chalega

```text
payment confirm  ->  trigger  ->  admin_alert_queue (row)
                                      |
                        pg_net  ->  /api/public/admin-alert/process
                                      |
                              AiSensy campaign  ->  aapka WhatsApp
                                      |
                                 admin_alert_log
```

## Trigger (sirf paid par)

- Home service: `bookings` par AFTER INSERT/UPDATE trigger — tabhi enqueue jab `razorpay_payment_id` pehli baar set ho (null se non-null / insert par already set).
- Courier: `courier_orders` par AFTER INSERT/UPDATE — tabhi jab `payment_status` `paid` bane.
- Merchant orders: same pattern, par `ops_settings.admin_whatsapp_alert_merchant_enabled` (default `0`) ke peeche.
- Trigger sirf ek row insert karta hai (exception-wrapped, `BEGIN ... EXCEPTION WHEN OTHERS THEN RETURN`), taaki alert fail hone par order kabhi block na ho. Trigger ke andar koi HTTP call nahi.
- Master toggle `ops_settings.admin_whatsapp_alert_enabled` (default `0`) off ho to trigger kuch bhi enqueue nahi karta.

## Message (sirf 4 values)

1. Order — home service: service label + duration; courier: `Local Parcel - Bike` (vehicle naam se banega).
2. Customer — `users.full_name`, khaali ho to `Customer`.
3. Amount — final payable (`total_amount`, fallback price+GST), plain number.
4. Time — home service: slot (`scheduled_date` + `scheduled_time_slot`, ya `Now` for now-bookings); courier: `Now`.

Har value se newline hata ke 60 chars par trim. Phone number, address, order id message me nahi jaate.

## Queue processing route

- `src/routes/api/public/admin-alert/process.ts`, POST only.
- Shared secret header se guarded — secret Vault me (`admin_alert_job_secret`), verify ek `admin_alert_verify_job_secret()` RPC se (courier refunds jaisa hi pattern). Secret galat/missing = 401, koi info leak nahi.
- Pending rows (max 20 per run) uthata hai, AiSensy campaign API call karta hai (`send-otp` jaisa hi shape), phir row ko `sent` ya `failed` mark karta hai.
- Retry: max 3 attempts, backoff ke saath; 3 ke baad `failed` + log.
- Rate cap: agar 1 minute me 20 se zyada alerts hain, to baaki ek single digest message me ("N naye orders, total Rs X") — spam aur AiSensy throttle dono se bachav.
- Poora loop try/catch me; ek order ka fail dusre ko nahi rokta.

## Secrets (kuch bhi hardcode nahi)

- `ADMIN_ALERT_PHONES` — comma separated numbers.
- `AISENSY_ADMIN_ALERT_CAMPAIGN` — campaign naam.
- Route ka shared secret — Vault me random generate hoga (migration me literal nahi).
- `AISENSY_API_KEY` already project me hai, wahi reuse.

## Tables

- `admin_alert_queue` — `order_type`, `order_id` (unique pair → idempotent, webhook retry par duplicate nahi), `payload` (4 values), `status`, `attempts`, `next_attempt_at`, timestamps.
- `admin_alert_log` — `order_type`, `order_id`, `status`, `error`, `created_at`.
- Dono par RLS on + deny-all; sirf `super_admin` read kar sakta hai, service_role ko full access. Customer, rider, anon ko kuch nahi.

## Toggle

- `ops_settings` me `admin_whatsapp_alert_enabled` (default `0`) aur `admin_whatsapp_alert_merchant_enabled` (default `0`). Sirf super_admin badal sake (existing ops_settings write policy ke hisaab se).

## Technical notes

- Migrations: (M1) tables + RLS + grants + ops_settings keys + Vault secret, (M2) enqueue function + triggers + pg_net dispatch function, (M3) rollback script (`admin_alert_teardown.sql` style, plan ke saath diya jaayega) — sab drop: triggers, functions, tables, ops_settings keys, Vault secret.
- Har nayi function `SECURITY DEFINER`, `SET search_path = public`, `REVOKE EXECUTE ... FROM anon, public`.
- pg_net dispatch `courier_dispatch_refund_job` jaisa: pending row ho tabhi HTTP post, exception-wrapped warning.
- Naye files: `src/routes/api/public/admin-alert/process.ts` (naya), `supabase/config.toml` unchanged, kisi existing payment/courier file me change nahi.

## Tests (report karunga)

- Idempotency: same order do baar enqueue → ek hi message.
- Trigger sirf paid par: unpaid/abandoned order → queue khaali.
- Toggle off → kuch enqueue nahi.
- AiSensy fail (galat campaign) → order/booking normal bane, row `failed` + log entry, retry schedule.
- RLS: customer/rider/anon queue+log par denied.
