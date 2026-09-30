CREATE OR REPLACE FUNCTION public.extend_booking(_booking_id uuid, _extra_minutes integer, _razorpay_payment_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid; _status text; _end timestamptz; _price numeric;
  _assigned uuid; _ext_id uuid; _opt uuid; _service uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _extra_minutes IS NULL OR _extra_minutes <= 0 THEN
    RAISE EXCEPTION 'Invalid extension duration';
  END IF;
  SELECT user_id, status, service_end_at, assigned_expert_id, price_option_id
    INTO _owner, _status, _end, _assigned, _opt
    FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _status <> 'in_progress' OR _end IS NULL THEN
    RAISE EXCEPTION 'Service not in progress';
  END IF;
  IF now() > _end + interval '10 minutes' THEN
    RAISE EXCEPTION 'Extension window closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.booking_extensions
     WHERE booking_id = _booking_id AND approval_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'An extension request is already pending';
  END IF;

  SELECT service_id INTO _service FROM public.service_price_options WHERE id = _opt;
  IF _service IS NULL THEN RAISE EXCEPTION 'Extension duration not available'; END IF;

  SELECT spo.customer_price INTO _price
    FROM public.service_price_options spo
    JOIN public.services s ON s.id = spo.service_id
   WHERE spo.service_id = _service
     AND COALESCE(spo.estimated_minutes, spo.duration_minutes) = _extra_minutes
     AND spo.is_active = true
     AND s.is_active = true
   ORDER BY spo.customer_price ASC
   LIMIT 1;

  IF _price IS NULL THEN RAISE EXCEPTION 'Extension duration not available'; END IF;

  INSERT INTO public.booking_extensions(booking_id, extra_minutes, price, razorpay_payment_id, approval_status)
    VALUES(_booking_id, _extra_minutes, _price, NULLIF(btrim(_razorpay_payment_id), ''), 'pending')
    RETURNING id INTO _ext_id;

  IF _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_alert(
      _assigned, 'extension_request', 'Extension requested',
      'Customer requested ' || _extra_minutes::text || ' more minutes (Rs ' || _price::text || ').',
      jsonb_build_object('booking_id', _booking_id, 'extension_id', _ext_id,
        'extra_minutes', _extra_minutes, 'price', _price,
        'route', 'booking/' || _booking_id::text)
    );
  END IF;

  PERFORM public.notify_customer_alert(
    _booking_id, 'extension_pending', 'Extra time requested',
    'We sent your request for ' || _extra_minutes::text || ' more minutes to your expert. We''ll let you know as soon as they respond.',
    jsonb_build_object('extension_id', _ext_id, 'extra_minutes', _extra_minutes,
      'route', 'booking/' || _booking_id::text)
  );

  RETURN jsonb_build_object('extension_id', _ext_id, 'approval_status', 'pending',
    'extra_minutes', _extra_minutes, 'price', _price, 'service_end_at', _end);
END
$function$;