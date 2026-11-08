CREATE OR REPLACE FUNCTION public.get_my_booking_otps(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT user_id, status, assigned_expert_id, start_otp, end_otp INTO b
    FROM public.bookings WHERE id = _booking_id AND deleted_at IS NULL;
  IF NOT FOUND OR b.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not found'; END IF;
  -- Self-heal: generate a missing code for the current stage.
  IF b.status IN ('expert_assigned','on_the_way','arrived','in_progress') AND (b.start_otp IS NULL OR btrim(b.start_otp)='') THEN
    b.start_otp := public.generate_otp4();
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET start_otp = b.start_otp WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;
  IF b.status = 'in_progress' AND (b.end_otp IS NULL OR btrim(b.end_otp)='') THEN
    b.end_otp := public.generate_otp4();
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET end_otp = b.end_otp WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);
  END IF;
  RETURN jsonb_build_object(
    'status', b.status,
    'start_otp', CASE WHEN b.status IN ('expert_assigned','on_the_way','arrived') THEN b.start_otp END,
    'end_otp', CASE WHEN b.status = 'in_progress' THEN b.end_otp END
  );
END $$;
REVOKE ALL ON FUNCTION public.get_my_booking_otps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_booking_otps(uuid) TO authenticated;