
-- M2: enqueue triggers + wake-on-enqueue dispatcher

CREATE OR REPLACE FUNCTION public.admin_alert_clean(_v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT left(nullif(btrim(regexp_replace(coalesce(_v, ''), '[\r\n\t]+', ' ', 'g')), ''), 60)
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_clean(text) FROM anon, public;

CREATE OR REPLACE FUNCTION public.admin_alert_enabled(_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT nullif(value, '')::numeric FROM public.ops_settings WHERE key = _key), 0) >= 1
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_enabled(text) FROM anon, public;

CREATE TABLE public.admin_alert_dispatch_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_dispatch_at timestamptz NOT NULL DEFAULT to_timestamp(0)
);
INSERT INTO public.admin_alert_dispatch_state (id) VALUES (true);
GRANT ALL ON public.admin_alert_dispatch_state TO service_role;
ALTER TABLE public.admin_alert_dispatch_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_alert_enqueue(
  _order_type text,
  _order_id uuid,
  _order text,
  _customer text,
  _amount numeric,
  _time text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_alert_queue (order_type, order_id, v_order, v_customer, v_amount, v_time)
  VALUES (
    _order_type,
    _order_id,
    coalesce(public.admin_alert_clean(_order), 'Order'),
    coalesce(public.admin_alert_clean(_customer), 'Customer'),
    left(trim(to_char(coalesce(_amount, 0), 'FM999999990.00')), 60),
    coalesce(public.admin_alert_clean(_time), 'Now')
  )
  ON CONFLICT (order_type, order_id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_enqueue failed: %', sqlerrm;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_enqueue(text, uuid, text, text, numeric, text) FROM anon, public;

-- Bookings
CREATE OR REPLACE FUNCTION public.admin_alert_on_booking_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _amount numeric;
  _when text;
BEGIN
  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_enabled') THEN RETURN NEW; END IF;

  SELECT u.full_name INTO _name FROM public.users u WHERE u.id = NEW.user_id;

  _amount := coalesce(nullif(NEW.total_amount, 0), NEW.price + coalesce(NEW.gst_amount, 0), NEW.price);

  IF NEW.slot_type = 'now' THEN
    _when := 'Now';
  ELSE
    _when := btrim(coalesce(NEW.scheduled_date::text, '') || ' ' || coalesce(NEW.scheduled_time_slot, ''));
  END IF;

  PERFORM public.admin_alert_enqueue(
    'booking',
    NEW.id,
    btrim(coalesce(NEW.service_label, 'Home Service') || ' - ' || coalesce(NEW.service_duration_minutes::text || ' min', '')),
    _name,
    _amount,
    _when
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_on_booking_paid failed: %', sqlerrm;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_on_booking_paid() FROM anon, public;

CREATE TRIGGER admin_alert_booking_paid_ins
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  WHEN (NEW.razorpay_payment_id IS NOT NULL AND length(NEW.razorpay_payment_id) > 0)
  EXECUTE FUNCTION public.admin_alert_on_booking_paid();

CREATE TRIGGER admin_alert_booking_paid_upd
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  WHEN (coalesce(OLD.razorpay_payment_id, '') = '' AND coalesce(NEW.razorpay_payment_id, '') <> '')
  EXECUTE FUNCTION public.admin_alert_on_booking_paid();

-- Courier orders
CREATE OR REPLACE FUNCTION public.admin_alert_on_courier_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _vehicle text;
  _amount numeric;
BEGIN
  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_enabled') THEN RETURN NEW; END IF;

  SELECT u.full_name INTO _name FROM public.users u WHERE u.id = NEW.customer_id;
  SELECT vt.name INTO _vehicle FROM public.courier_vehicle_types vt WHERE vt.id = NEW.vehicle_type_id;

  _amount := coalesce(nullif(NEW.total_amount, 0), NEW.base_amount + coalesce(NEW.gst_amount, 0), NEW.base_amount);

  PERFORM public.admin_alert_enqueue(
    'courier',
    NEW.id,
    'Local Parcel - ' || coalesce(_vehicle, 'Bike'),
    _name,
    _amount,
    'Now'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_on_courier_paid failed: %', sqlerrm;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_on_courier_paid() FROM anon, public;

CREATE TRIGGER admin_alert_courier_paid_ins
  AFTER INSERT ON public.courier_orders
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid')
  EXECUTE FUNCTION public.admin_alert_on_courier_paid();

CREATE TRIGGER admin_alert_courier_paid_upd
  AFTER UPDATE ON public.courier_orders
  FOR EACH ROW
  WHEN (OLD.payment_status IS DISTINCT FROM 'paid' AND NEW.payment_status = 'paid')
  EXECUTE FUNCTION public.admin_alert_on_courier_paid();

-- Merchant orders (own flag, default off)
CREATE OR REPLACE FUNCTION public.admin_alert_on_merchant_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _name text;
BEGIN
  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_enabled') THEN RETURN NEW; END IF;
  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_merchant_enabled') THEN RETURN NEW; END IF;

  SELECT u.full_name INTO _name FROM public.users u WHERE u.id = NEW.user_id;

  PERFORM public.admin_alert_enqueue(
    'merchant',
    NEW.id,
    'Store Order',
    _name,
    coalesce(NEW.total_amount, 0),
    'Now'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_on_merchant_paid failed: %', sqlerrm;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_on_merchant_paid() FROM anon, public;

CREATE TRIGGER admin_alert_merchant_paid_ins
  AFTER INSERT ON public.merchant_orders
  FOR EACH ROW
  WHEN (NEW.status IN ('paid', 'confirmed'))
  EXECUTE FUNCTION public.admin_alert_on_merchant_paid();

CREATE TRIGGER admin_alert_merchant_paid_upd
  AFTER UPDATE ON public.merchant_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('paid', 'confirmed'))
  EXECUTE FUNCTION public.admin_alert_on_merchant_paid();

-- Dispatcher: wakes the app route, throttled to once per 15 seconds.
CREATE OR REPLACE FUNCTION public.admin_alert_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  _secret text;
  _ok boolean;
BEGIN
  BEGIN
    DELETE FROM net._http_response WHERE created < now() - interval '1 hour';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'admin_alert_dispatch cleanup failed: %', sqlerrm;
  END;

  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_enabled') THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_alert_queue
    WHERE status = 'pending' AND next_attempt_at <= now()
  ) THEN
    RETURN;
  END IF;

  UPDATE public.admin_alert_dispatch_state
     SET last_dispatch_at = now()
   WHERE last_dispatch_at < now() - interval '15 seconds'
  RETURNING true INTO _ok;
  IF _ok IS NOT TRUE THEN RETURN; END IF;

  SELECT decrypted_secret INTO _secret FROM vault.decrypted_secrets WHERE name = 'admin_alert_job_secret';
  IF _secret IS NULL THEN RAISE WARNING 'admin_alert_job_secret missing'; RETURN; END IF;

  PERFORM net.http_post(
    url := 'https://user.badiyos.com/api/public/admin-alert/process',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-admin-alert-secret', _secret),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_dispatch failed: %', sqlerrm;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_dispatch() FROM anon, public;

-- Wake the worker as soon as a row is queued.
CREATE OR REPLACE FUNCTION public.admin_alert_queue_wake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.admin_alert_dispatch();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_queue_wake failed: %', sqlerrm;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_alert_queue_wake() FROM anon, public;

CREATE TRIGGER admin_alert_queue_wake_trg
  AFTER INSERT ON public.admin_alert_queue
  FOR EACH ROW EXECUTE FUNCTION public.admin_alert_queue_wake();

-- Hourly backstop: retries anything still pending and prunes pg_net responses.
SELECT cron.schedule('admin-alert-backstop', '0 * * * *', 'select public.admin_alert_dispatch();');
