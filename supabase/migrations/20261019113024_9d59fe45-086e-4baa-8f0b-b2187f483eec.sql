CREATE OR REPLACE FUNCTION public.bookings_fill_missing_otps()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IN ('expert_assigned','on_the_way','arrived','in_progress')
     AND (NEW.start_otp IS NULL OR btrim(NEW.start_otp) = '') THEN
    NEW.start_otp := public.generate_otp4();
  END IF;
  IF NEW.status = 'in_progress' AND (NEW.end_otp IS NULL OR btrim(NEW.end_otp) = '') THEN
    NEW.end_otp := public.generate_otp4();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_bookings_fill_missing_otps ON public.bookings;
CREATE TRIGGER zz_bookings_fill_missing_otps
BEFORE INSERT OR UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_fill_missing_otps();

CREATE OR REPLACE FUNCTION public.ensure_end_otp(_booking_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status text; _otp text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT user_id, status, end_otp INTO _owner, _status, _otp FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _otp IS NOT NULL AND btrim(_otp) <> '' THEN RETURN _otp; END IF;
  IF _status <> 'in_progress' THEN RAISE EXCEPTION 'Check-out code not available yet'; END IF;
  _otp := public.generate_otp4();
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET end_otp = _otp WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);
  RETURN _otp;
END $$;
REVOKE ALL ON FUNCTION public.ensure_end_otp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_end_otp(uuid) TO authenticated, service_role;

DO $$ BEGIN
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings SET end_otp = public.generate_otp4()
   WHERE status = 'in_progress' AND end_otp IS NULL AND deleted_at IS NULL;
  UPDATE public.bookings SET start_otp = public.generate_otp4()
   WHERE status IN ('expert_assigned','on_the_way','arrived','in_progress') AND start_otp IS NULL AND deleted_at IS NULL;
  PERFORM set_config('app.booking_bypass','off', true);
END $$;