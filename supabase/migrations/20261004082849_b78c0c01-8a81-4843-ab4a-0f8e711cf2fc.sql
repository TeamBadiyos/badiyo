CREATE OR REPLACE FUNCTION public.extend_booking(_booking_id uuid, _extra_minutes integer, _razorpay_payment_id text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid; _status text; _end timestamptz; _price numeric;
  _assigned uuid; _ext_id uuid; _opt uuid; _service uuid; _new_end timestamptz;
  _pay text := NULLIF(btrim(_razorpay_payment_id), '');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _extra_minutes IS NULL OR _extra_minutes <= 0 THEN RAISE EXCEPTION 'Invalid extension duration'; END IF;
  SELECT user_id, status, service_end_at, assigned_expert_id, price_option_id
    INTO _owner, _status, _end, _assigned, _opt
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _status <> 'in_progress' OR _end IS NULL THEN RAISE EXCEPTION 'Service not in progress'; END IF;
  IF _pay IS NULL THEN RAISE EXCEPTION 'Payment required'; END IF;
  IF EXISTS (SELECT 1 FROM public.booking_extensions WHERE razorpay_payment_id = _pay) THEN
    RAISE EXCEPTION 'Payment already used';
  END IF;

  SELECT service_id INTO _service FROM public.service_price_options WHERE id = _opt;
  IF _service IS NULL THEN RAISE EXCEPTION 'Extension duration not available'; END IF;
  SELECT spo.customer_price INTO _price
    FROM public.service_price_options spo JOIN public.services s ON s.id = spo.service_id
   WHERE spo.service_id = _service
     AND COALESCE(spo.estimated_minutes, spo.duration_minutes) = _extra_minutes
     AND spo.is_active AND s.is_active
   ORDER BY spo.customer_price ASC LIMIT 1;
  IF _price IS NULL THEN RAISE EXCEPTION 'Extension duration not available'; END IF;

  -- Customer already paid: extend immediately (late payment still gets full time).
  _new_end := GREATEST(_end, now()) + make_interval(mins => _extra_minutes);
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET service_end_at = _new_end, price = COALESCE(price,0) + _price,
         reminder_sent = false, updated_at = now() WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.booking_extensions(booking_id, extra_minutes, price, razorpay_payment_id, approval_status)
    VALUES(_booking_id, _extra_minutes, _price, _pay, 'accepted') RETURNING id INTO _ext_id;

  IF _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_alert(_assigned, 'extension_request', 'Service extended',
      'Customer paid for ' || _extra_minutes::text || ' more minutes (Rs ' || _price::text || ').',
      jsonb_build_object('booking_id', _booking_id, 'extension_id', _ext_id,
        'extra_minutes', _extra_minutes, 'price', _price, 'service_end_at', _new_end,
        'route', 'booking/' || _booking_id::text));
  END IF;

  RETURN jsonb_build_object('extension_id', _ext_id, 'approval_status', 'accepted',
    'extra_minutes', _extra_minutes, 'price', _price, 'service_end_at', _new_end);
END
$function$;

-- One-off: apply the paid-but-pending extension(s) still stuck in pending.
DO $$
DECLARE r record; _new_end timestamptz;
BEGIN
  FOR r IN SELECT x.*, b.service_end_at FROM public.booking_extensions x
           JOIN public.bookings b ON b.id = x.booking_id
           WHERE x.approval_status = 'pending' AND x.razorpay_payment_id IS NOT NULL
             AND b.status = 'in_progress' LOOP
    _new_end := GREATEST(r.service_end_at, now()) + make_interval(mins => r.extra_minutes);
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET service_end_at = _new_end, price = COALESCE(price,0) + COALESCE(r.price,0),
           reminder_sent = false, updated_at = now() WHERE id = r.booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
    UPDATE public.booking_extensions SET approval_status = 'accepted' WHERE id = r.id;
  END LOOP;
END $$;