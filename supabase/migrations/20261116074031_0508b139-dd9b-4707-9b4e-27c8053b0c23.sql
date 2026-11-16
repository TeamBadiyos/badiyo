DO $$
DECLARE o record; s record; code text; payload jsonb; repeated jsonb; regenerated integer:=0; checked_orders integer:=0; visible_stops integer:=0; original_sub text:=current_setting('request.jwt.claim.sub',true);
BEGIN
  IF public.courier_otp_key() IS NULL THEN RAISE EXCEPTION 'Parcel OTP signing configuration missing'; END IF;
  FOR o IN SELECT id,customer_id FROM public.courier_orders WHERE status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT') AND NOT public.courier_is_gifting_order(id) ORDER BY id FOR UPDATE LOOP
    IF NOT EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=o.id AND stop_type='pickup') OR NOT EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=o.id AND stop_type='drop') THEN RAISE EXCEPTION 'Active courier order is missing pickup or drop stops'; END IF;
    FOR s IN SELECT st.id FROM public.courier_order_stops st LEFT JOIN public.courier_stop_secrets x ON x.stop_id=st.id WHERE st.order_id=o.id AND st.status NOT IN ('completed','failed','cancelled') AND st.stop_type IN ('pickup','drop','return') AND x.verified_at IS NULL ORDER BY st.sequence FOR UPDATE OF st LOOP
      code:=public.courier_issue_stop_otp(s.id);
      IF code IS NULL THEN RAISE EXCEPTION 'Pending courier stop code generation failed'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.courier_stop_secrets x WHERE x.stop_id=s.id AND x.otp_hash=public.courier_hash_otp(code) AND x.otp_issued_at IS NOT NULL AND x.otp_expires_at>now()) THEN RAISE EXCEPTION 'Generated courier code is not verifiable'; END IF;
      regenerated:=regenerated+1;
    END LOOP;
    PERFORM set_config('request.jwt.claim.sub',o.customer_id::text,true);
    payload:=public.get_my_courier_otps(o.id);
    repeated:=public.get_my_courier_otps(o.id);
    IF payload IS DISTINCT FROM repeated THEN RAISE EXCEPTION 'Repeated reads must preserve current codes'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'stops') st WHERE (st->>'visible')::boolean AND coalesce(st->>'pickup_otp',st->>'drop_otp') IS NULL) THEN RAISE EXCEPTION 'Every visible active stop must have a code'; END IF;
    SELECT visible_stops+count(*) INTO visible_stops FROM jsonb_array_elements(payload->'stops') st WHERE (st->>'visible')::boolean;
    checked_orders:=checked_orders+1;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  RAISE NOTICE 'Courier regeneration and live checks passed: % orders, % regenerated stops, % visible stops',checked_orders,regenerated,visible_stops;
END $$;