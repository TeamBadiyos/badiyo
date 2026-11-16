-- Real active orders are read only through their owner gate; never print codes.
DO $$
DECLARE o record; a jsonb; b jsonb; denied boolean; original_sub text := current_setting('request.jwt.claim.sub',true);
BEGIN
  IF has_function_privilege('anon','public.get_my_courier_otps(uuid)','execute') THEN
    RAISE EXCEPTION 'Anonymous users must not execute customer OTP access';
  END IF;
  FOR o IN SELECT id,customer_id FROM public.courier_orders WHERE store_order_id IS NULL AND status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT') LOOP
    PERFORM set_config('request.jwt.claim.sub','',true);
    denied := false;
    BEGIN PERFORM public.get_my_courier_otps(o.id); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Unauthenticated OTP access must fail'; END IF;
    PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
    denied := false;
    BEGIN PERFORM public.get_my_courier_otps(o.id); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
    IF NOT denied THEN RAISE EXCEPTION 'Another customer must not read OTPs'; END IF;
    PERFORM set_config('request.jwt.claim.sub',o.customer_id::text,true);
    a := public.get_my_courier_otps(o.id);
    b := public.get_my_courier_otps(o.id);
    IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'Repeated reads must preserve current codes'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(a->'stops') s WHERE (s->>'visible')::boolean AND coalesce(s->>'pickup_otp',s->>'drop_otp') IS NULL) THEN
      RAISE EXCEPTION 'Every visible active stop must have a code';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(a->'stops') s WHERE s->>'status' IN ('completed','failed','cancelled') AND coalesce(s->>'pickup_otp',s->>'drop_otp') IS NOT NULL) THEN
      RAISE EXCEPTION 'Terminal stops must not expose codes';
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
END $$;