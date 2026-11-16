CREATE OR REPLACE FUNCTION public.get_my_courier_otps(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.courier_orders%rowtype; s public.courier_order_stops%rowtype; x public.courier_stop_secrets%rowtype;
  code text; rows jsonb := '[]'::jsonb; pickup_code text; pending_pickups boolean; visible boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING errcode='42501'; END IF;
  SELECT * INTO o FROM public.courier_orders WHERE id=_order_id FOR UPDATE;
  IF o.id IS NULL OR o.customer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  IF o.status NOT IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT') OR public.courier_is_gifting_order(o.id) THEN RETURN jsonb_build_object('status',o.status,'pickup_otp',NULL,'stops',rows); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=o.id AND stop_type='pickup') OR NOT EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=o.id AND stop_type='drop') THEN RAISE EXCEPTION 'Parcel stops missing; OTP cannot be generated'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.courier_order_stops WHERE order_id=o.id AND stop_type='pickup' AND status NOT IN ('completed','failed','cancelled')) INTO pending_pickups;
  FOR s IN SELECT * FROM public.courier_order_stops WHERE order_id=o.id ORDER BY sequence FOR UPDATE LOOP
    code := NULL; x := NULL;
    visible := s.status NOT IN ('completed','failed','cancelled') AND ((s.stop_type='pickup' AND pending_pickups) OR (s.stop_type IN ('drop','return') AND NOT pending_pickups));
    IF visible THEN
      INSERT INTO public.courier_stop_secrets(stop_id) VALUES(s.id) ON CONFLICT DO NOTHING;
      SELECT * INTO x FROM public.courier_stop_secrets WHERE stop_id=s.id FOR UPDATE;
      IF x.verified_at IS NULL THEN
        IF x.otp_issued_at IS NULL OR x.otp_hash IS NULL OR x.otp_expires_at IS NULL OR x.otp_expires_at<=now() THEN code := public.courier_issue_stop_otp(s.id);
        ELSE code := public.courier_derive_otp(s.id,public.courier_stop_purpose(s.stop_type),x.otp_issued_at); END IF;
      END IF;
    END IF;
    IF s.stop_type='pickup' AND pickup_code IS NULL THEN pickup_code := code; END IF;
    rows := rows || jsonb_build_array(jsonb_build_object('stop_id',s.id,'stop_type',s.stop_type,'sequence',s.sequence,'contact_name',s.contact_name,'status',s.status,'visible',visible AND x.verified_at IS NULL,'pickup_otp',CASE WHEN s.stop_type='pickup' THEN code END,'drop_otp',CASE WHEN s.stop_type IN ('drop','return') THEN code END));
  END LOOP;
  RETURN jsonb_build_object('status',o.status,'pickup_otp',pickup_code,'stops',rows);
END $$;
COMMENT ON FUNCTION public.get_my_courier_otps(uuid) IS 'Intentional authenticated SECURITY DEFINER endpoint: auth.uid() required; customer_id IS DISTINCT FROM auth.uid() denied before stop/secret access; anon/PUBLIC revoked; only stage-visible plain codes returned, never hashes or keys.';
REVOKE ALL ON FUNCTION public.get_my_courier_otps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_courier_otps(uuid) TO authenticated;
DO $$ DECLARE o record; old_sub text:=current_setting('request.jwt.claim.sub',true); BEGIN
 FOR o IN SELECT id,customer_id FROM public.courier_orders WHERE store_order_id IS NULL AND status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT') LOOP
  PERFORM set_config('request.jwt.claim.sub',o.customer_id::text,true);
  PERFORM public.get_my_courier_otps(o.id);
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
END $$;