-- Rollback: removes the temporary admin WhatsApp alert system completely.
-- Run as a single migration. Nothing in booking / payment / courier logic is touched.

DROP TRIGGER IF EXISTS admin_alert_booking_paid_ins ON public.bookings;
DROP TRIGGER IF EXISTS admin_alert_booking_paid_upd ON public.bookings;
DROP TRIGGER IF EXISTS admin_alert_courier_paid_ins ON public.courier_orders;
DROP TRIGGER IF EXISTS admin_alert_courier_paid_upd ON public.courier_orders;
DROP TRIGGER IF EXISTS admin_alert_merchant_paid_ins ON public.merchant_orders;
DROP TRIGGER IF EXISTS admin_alert_merchant_paid_upd ON public.merchant_orders;
DROP TRIGGER IF EXISTS admin_alert_queue_wake_trg ON public.admin_alert_queue;
DROP TRIGGER IF EXISTS admin_alert_settings_guard_trg ON public.ops_settings;

SELECT cron.unschedule('admin-alert-backstop');

DROP FUNCTION IF EXISTS public.admin_alert_on_booking_paid();
DROP FUNCTION IF EXISTS public.admin_alert_on_courier_paid();
DROP FUNCTION IF EXISTS public.admin_alert_on_merchant_paid();
DROP FUNCTION IF EXISTS public.admin_alert_queue_wake();
DROP FUNCTION IF EXISTS public.admin_alert_settings_guard();
DROP FUNCTION IF EXISTS public.admin_alert_dispatch();
DROP FUNCTION IF EXISTS public.admin_alert_enqueue(text, uuid, text, text, numeric, text);
DROP FUNCTION IF EXISTS public.admin_alert_claim_batch(int);
DROP FUNCTION IF EXISTS public.admin_alert_mark(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.admin_alert_verify_job_secret(text);
DROP FUNCTION IF EXISTS public.admin_alert_enabled(text);
DROP FUNCTION IF EXISTS public.admin_alert_clean(text);

DROP TABLE IF EXISTS public.admin_alert_queue;
DROP TABLE IF EXISTS public.admin_alert_log;
DROP TABLE IF EXISTS public.admin_alert_dispatch_state;

DELETE FROM public.ops_settings
 WHERE key IN ('admin_whatsapp_alert_enabled', 'admin_whatsapp_alert_merchant_enabled');

DELETE FROM vault.secrets WHERE name = 'admin_alert_job_secret';

DELETE FROM net._http_response WHERE created < now();

-- Also delete the secrets ADMIN_ALERT_PHONES and AISENSY_ADMIN_ALERT_CAMPAIGN
-- and the file src/routes/api/public/admin-alert/process.ts.
