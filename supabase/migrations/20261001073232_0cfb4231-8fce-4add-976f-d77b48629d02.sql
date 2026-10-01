CREATE OR REPLACE FUNCTION public.ensure_start_otp(_booking_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status text; _otp text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT user_id, status, start_otp INTO _owner, _status, _otp
    FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _otp IS NOT NULL THEN RETURN _otp; END IF;
  IF _status NOT IN ('expert_assigned','on_the_way','arrived','in_progress','completed') THEN
    RAISE EXCEPTION 'Start code not available yet';
  END IF;
  _otp := public.generate_otp4();
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET start_otp = _otp WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);
  RETURN _otp;
END;$function$;

DO $$ BEGIN
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET start_otp = public.generate_otp4()
   WHERE start_otp IS NULL AND deleted_at IS NULL
     AND status IN ('expert_assigned','on_the_way','arrived');
  PERFORM set_config('app.booking_bypass','off', true);
END $$;