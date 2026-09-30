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

  -- Self-healing throttle row: recreate it when missing so alerts never stall.
  INSERT INTO public.admin_alert_dispatch_state (id, last_dispatch_at)
  VALUES (true, now())
  ON CONFLICT (id) DO UPDATE
    SET last_dispatch_at = now()
  WHERE public.admin_alert_dispatch_state.last_dispatch_at < now() - interval '15 seconds'
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