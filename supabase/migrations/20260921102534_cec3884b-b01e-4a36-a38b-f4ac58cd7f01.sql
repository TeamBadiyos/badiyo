
INSERT INTO public.edge_runtime_config (key, value)
VALUES ('push_endpoint_url', 'https://user.badiyos.com/api/public/push/send')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.notify_push_event(
  _user_type text, _user_id uuid, _alert_type text, _title text, _body text, _data jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _url text;
  _secret text;
BEGIN
  BEGIN
    IF _user_id IS NULL THEN RETURN; END IF;

    SELECT value INTO _secret FROM public.edge_runtime_config WHERE key = 'push_trigger_secret';
    IF _secret IS NULL OR _secret = '' THEN RETURN; END IF;

    SELECT value INTO _url FROM public.edge_runtime_config WHERE key = 'push_endpoint_url';
    IF _url IS NULL OR _url = '' THEN
      _url := 'https://user.badiyos.com/api/public/push/send';
    END IF;

    PERFORM net.http_post(
      url := _url,
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-internal-secret', _secret
      ),
      body := jsonb_build_object(
        'user_type', _user_type,
        'user_id', _user_id,
        'alert_type', _alert_type,
        'title', _title,
        'body', _body,
        'data', COALESCE(_data, '{}'::jsonb) || jsonb_build_object('alert_type', _alert_type)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_push_event] % failed for %: %', _alert_type, _user_id, SQLERRM;
  END;
END;
$function$;

-- Legacy helpers now delegate to the single sender and always carry an alert type.
CREATE OR REPLACE FUNCTION public.notify_customer_push(_booking_id uuid, _title text, _body text, _route text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _user_id uuid;
BEGIN
  SELECT user_id INTO _user_id FROM public.bookings WHERE id = _booking_id;
  IF _user_id IS NULL THEN RETURN; END IF;
  PERFORM public.notify_push_event(
    'customer', _user_id, 'booking_update', _title, _body,
    jsonb_build_object('route', _route, 'booking_id', _booking_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_customer_user_push(_user_id uuid, _title text, _body text, _route text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;
  PERFORM public.notify_push_event(
    'customer', _user_id, 'general', _title, _body,
    jsonb_build_object('route', _route)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_expert_push(_expert_id uuid, _title text, _body text, _route text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF _expert_id IS NULL THEN RETURN; END IF;
  PERFORM public.notify_push_event(
    'expert', _expert_id, 'general', _title, _body,
    jsonb_build_object('route', _route)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_send_campaign(_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role text;
  _city text;
  _before jsonb;
  _row public.marketing_campaigns%ROWTYPE;
  _total integer := 0;
  _rec record;
  _route text;
  _has_token boolean;
  _delivery_id uuid;
BEGIN
  _role := public.offers_require_writer();

  SELECT to_jsonb(c) INTO _before FROM public.marketing_campaigns c WHERE c.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  IF (_before->>'status') = 'sent' THEN RAISE EXCEPTION 'Campaign already sent'; END IF;

  IF _role = 'ops_manager' THEN
    _city := public.offers_caller_city(auth.uid());
    IF _city IS NULL OR (_before->>'audience') <> _city THEN
      RAISE EXCEPTION 'You can only send campaigns for your own city';
    END IF;
  END IF;

  _route := COALESCE(NULLIF(_before->>'deep_link', ''), 'offers');

  FOR _rec IN
    SELECT DISTINCT u.id
    FROM public.users u
    WHERE u.deleted_at IS NULL
      AND (
        (_before->>'audience') = 'all'
        OR EXISTS (
          SELECT 1 FROM public.addresses a
          WHERE a.user_id = u.id
            AND a.city ILIKE (_before->>'audience')
        )
      )
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.device_tokens d
      WHERE d.user_id = _rec.id AND d.user_type = 'customer'
    ) INTO _has_token;

    INSERT INTO public.campaign_deliveries (campaign_id, user_id, status, error)
    VALUES (
      _id, _rec.id,
      CASE WHEN _has_token THEN 'queued' ELSE 'failed' END,
      CASE WHEN _has_token THEN NULL ELSE 'App not installed / no registered device' END
    )
    ON CONFLICT (campaign_id, user_id) DO UPDATE
      SET status = EXCLUDED.status, error = EXCLUDED.error
    RETURNING id INTO _delivery_id;

    IF _has_token THEN
      BEGIN
        PERFORM public.notify_push_event(
          'customer', _rec.id, 'campaign',
          _before->>'title', COALESCE(_before->>'body',''),
          jsonb_build_object('route', _route, 'campaign_delivery_id', _delivery_id)
        );
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.campaign_deliveries
           SET status = 'failed', error = 'Push request failed: ' || SQLERRM
         WHERE id = _delivery_id;
      END;
    END IF;

    _total := _total + 1;
  END LOOP;

  UPDATE public.marketing_campaigns SET
    status = 'sent',
    sent_at = now(),
    recipients_count = _total,
    starts_at = COALESCE(starts_at, now()),
    updated_at = now()
  WHERE id = _id RETURNING * INTO _row;

  PERFORM public.offers_audit('campaign_sent', 'marketing_campaigns', _id, _before, to_jsonb(_row));
  RETURN _total;
END;
$function$;
