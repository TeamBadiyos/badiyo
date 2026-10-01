CREATE OR REPLACE FUNCTION public.claim_booking_as_expert(p_booking_id uuid)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expert_id uuid; v_exp_lat numeric; v_exp_lng numeric; v_is_busy boolean;
  v_bk_lat numeric; v_bk_lng numeric; v_radius numeric; v_distance numeric;
  v_current_status text; v_current_assigned uuid; v_cat uuid; v_bk_radius numeric;
  v_row public.bookings; v_expert_name text; v_before jsonb; v_after jsonb;
BEGIN
  v_expert_id := public.get_expert_id_for_auth(auth.uid());
  IF v_expert_id IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  SELECT current_lat, current_lng, is_busy, name
    INTO v_exp_lat, v_exp_lng, v_is_busy, v_expert_name
    FROM public.experts WHERE id = v_expert_id FOR UPDATE;

  IF v_is_busy THEN
    RAISE EXCEPTION 'You already have an active booking. Complete it before accepting a new one.';
  END IF;
  IF v_exp_lat IS NULL OR v_exp_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  SELECT booking_lat, booking_lng, status, assigned_expert_id, service_category_id,
         current_search_radius_km
    INTO v_bk_lat, v_bk_lng, v_current_status, v_current_assigned, v_cat, v_bk_radius
    FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_bk_lat IS NULL OR v_bk_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  -- Use the radius the dispatcher is actually broadcasting at, so an expert who
  -- was offered the job at an expanded radius can also accept it.
  SELECT GREATEST(COALESCE(v_bk_radius, 0), COALESCE(broadcast_radius_km, 5))
    INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := GREATEST(COALESCE(v_bk_radius, 0), 5); END IF;

  IF v_cat IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.partner_skills ps
    WHERE ps.expert_id = v_expert_id AND ps.status = 'approved'
      AND ps.service_category_id = v_cat
  ) THEN
    RAISE EXCEPTION 'You are not approved for this service category.';
  END IF;

  v_distance := public.haversine_km(v_exp_lat, v_exp_lng, v_bk_lat, v_bk_lng);
  IF v_distance > v_radius THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

  IF v_current_status <> 'accepted' OR v_current_assigned IS NOT NULL THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  SELECT to_jsonb(b) INTO v_before FROM public.bookings b WHERE id = p_booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
    SET assigned_expert_id = v_expert_id, status = 'expert_assigned', updated_at = now()
    WHERE id = p_booking_id AND status = 'accepted' AND assigned_expert_id IS NULL
    RETURNING * INTO v_row;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This booking has already been accepted by another expert.';
  END IF;

  UPDATE public.experts SET is_busy = true WHERE id = v_expert_id;

  SELECT to_jsonb(b) INTO v_after FROM public.bookings b WHERE id = p_booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (auth.uid(), 'claim_booking', 'bookings', p_booking_id, v_before,
    v_after || jsonb_build_object('actor_role', 'expert', 'expert_id', v_expert_id, 'distance_km', v_distance));

  RETURN v_row;
END;
$$;