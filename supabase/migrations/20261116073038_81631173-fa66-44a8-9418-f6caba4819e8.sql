CREATE OR REPLACE FUNCTION public.courier_issue_stop_otp(_stop_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _st public.courier_order_stops%rowtype; _p text; _issued timestamptz := clock_timestamp(); _prev timestamptz; _otp text;
BEGIN
  SELECT * INTO _st FROM public.courier_order_stops WHERE id=_stop_id;
  IF _st.id IS NULL THEN RAISE EXCEPTION 'Stop not found'; END IF;
  IF public.courier_is_gifting_order(_st.order_id) THEN RETURN NULL; END IF;
  IF public.courier_otp_key() IS NULL THEN RAISE EXCEPTION 'Parcel OTP signing configuration missing'; END IF;
  _p := public.courier_stop_purpose(_st.stop_type);
  INSERT INTO public.courier_stop_secrets(stop_id) VALUES(_stop_id) ON CONFLICT DO NOTHING;
  SELECT otp_issued_at INTO _prev FROM public.courier_stop_secrets WHERE stop_id=_stop_id FOR UPDATE;
  IF _prev IS NOT NULL AND _issued<=_prev THEN _issued:=_prev+interval '1 microsecond'; END IF;
  _otp:=public.courier_derive_otp(_stop_id,_p,_issued);
  IF _otp IS NULL THEN RAISE EXCEPTION 'Parcel OTP generation failed'; END IF;
  UPDATE public.courier_stop_secrets SET otp_hash=public.courier_hash_otp(_otp),otp_issued_at=_issued,otp_expires_at=clock_timestamp()+interval '12 hours',attempts=0,updated_at=now() WHERE stop_id=_stop_id;
  BEGIN PERFORM public.courier_notify_stop_contact(_stop_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN _otp;
END $$;