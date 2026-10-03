
-- 1. Experts
ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS mode text;
UPDATE public.experts SET mode = 'LIVE' WHERE mode IS NULL;
ALTER TABLE public.experts ALTER COLUMN mode SET NOT NULL;
ALTER TABLE public.experts ADD CONSTRAINT experts_mode_check CHECK (mode IN ('TRAINING','LIVE'));
ALTER TABLE public.experts ALTER COLUMN mode SET DEFAULT 'TRAINING';
ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS training_orders_completed integer NOT NULL DEFAULT 0;
ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS training_completed_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS experts_mode_idx ON public.experts(mode);

-- 2. Bookings
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS is_training boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS bookings_is_training_idx ON public.bookings(is_training);

-- Default training address setting
INSERT INTO public.ops_settings(key, value, label)
VALUES ('training_address',
  '{"full_address":"Badiyos Training Address, Latur","area":"Training","city":"Latur","latitude":18.4088,"longitude":76.5604}',
  'Default address used for expert training orders (JSON)')
ON CONFLICT (key) DO NOTHING;

-- Helper: does expert mode match booking type?
CREATE OR REPLACE FUNCTION public.booking_expert_mode_ok(_booking_id uuid, _expert_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b, public.experts e
     WHERE b.id = _booking_id AND e.id = _expert_id
       AND e.mode = CASE WHEN b.is_training THEN 'TRAINING' ELSE 'LIVE' END)
$$;
REVOKE ALL ON FUNCTION public.booking_expert_mode_ok(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_expert_mode_ok(uuid, uuid) TO authenticated, service_role;

-- Patch helper (temporary)
CREATE OR REPLACE FUNCTION public._tm_patch(_fn text, _old text, _new text, _regex boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $p$
DECLARE _oid oid; _def text; _nd text; _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname=_fn;
  IF _n <> 1 THEN RAISE EXCEPTION 'patch %: expected 1 function, found %', _fn, _n; END IF;
  SELECT p.oid INTO _oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname=_fn;
  _def := pg_get_functiondef(_oid);
  IF _regex THEN _nd := regexp_replace(_def, _old, _new);
  ELSE
    IF position(_old in _def) = 0 THEN RAISE EXCEPTION 'patch %: anchor not found: %', _fn, _old; END IF;
    _nd := replace(_def, _old, _new);
  END IF;
  IF _nd = _def THEN RAISE EXCEPTION 'patch %: nothing changed', _fn; END IF;
  EXECUTE _nd;
END $p$;

-- bookings insert trigger: reset is_training for non-server inserts; zero amount for training
SELECT public._tm_patch('bookings_before_insert',
  'NEW.delete_reason := null;',
  'NEW.delete_reason := null;
    NEW.is_training := false;');
SELECT public._tm_patch('bookings_before_insert',
  'NEW.total_amount := NEW.price + NEW.gst_amount;',
  'NEW.total_amount := NEW.price + NEW.gst_amount;
  IF COALESCE(NEW.is_training, false) THEN
    NEW.price := 0; NEW.gst_amount := 0; NEW.total_amount := 0;
  END IF;');

-- Training orders are treated as confirmed/free for dispatch
SELECT public._tm_patch('bookings_auto_dispatch',
  $r$_free := coalesce(NEW.total_amount, 0) = 0 and coalesce(NEW.razorpay_order_id, '') like 'free\_%';$r$,
  $r$_free := (coalesce(NEW.total_amount, 0) = 0 and coalesce(NEW.razorpay_order_id, '') like 'free\_%') or coalesce(NEW.is_training, false);$r$);
SELECT public._tm_patch('booking_dispatch_release_due',
  $r$and (coalesce(razorpay_payment_id,'') <> '' or$r$,
  $r$and (is_training or coalesce(razorpay_payment_id,'') <> '' or$r$);

-- Broadcast: only matching mode (both preferred and radius loops)
SELECT public._tm_patch('broadcast_booking_to_experts',
  $r$AND e.status = 'active'$r$,
  $r$AND e.status = 'active' AND e.mode = (CASE WHEN COALESCE(b.is_training,false) THEN 'TRAINING' ELSE 'LIVE' END)$r$);
SELECT public._tm_patch('get_eligible_experts_for_booking',
  $r$AND e.status = 'active'$r$,
  $r$AND e.status = 'active' AND public.booking_expert_mode_ok(p_booking_id, e.id)$r$);
SELECT public._tm_patch('get_broadcast_booking_address',
  'IF v_addr IS NULL THEN RETURN; END IF;',
  'IF v_addr IS NULL THEN RETURN; END IF;
  IF v_assigned IS DISTINCT FROM v_expert_id AND NOT public.booking_expert_mode_ok(p_booking_id, v_expert_id) THEN RETURN; END IF;');

-- Accept / assign re-check
SELECT public._tm_patch('claim_booking_as_expert',
  $r$IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;$r$,
  $r$IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT public.booking_expert_mode_ok(p_booking_id, v_expert_id) THEN
    RAISE EXCEPTION 'MODE_MISMATCH: This booking is not available for your account.';
  END IF;$r$);
SELECT public._tm_patch('staff_assign_expert',
  $r$IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;$r$,
  $r$IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT public.booking_expert_mode_ok(_booking_id, _expert_id) THEN
    RAISE EXCEPTION 'MODE_MISMATCH: Training bookings need a training expert, live bookings need a live expert.';
  END IF;$r$);
SELECT public._tm_patch('staff_reassign_expert',
  $r$IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;$r$,
  $r$IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT public.booking_expert_mode_ok(_booking_id, _new_expert_id) THEN
    RAISE EXCEPTION 'MODE_MISMATCH: Training bookings need a training expert, live bookings need a live expert.';
  END IF;$r$);

-- Available orders list (RLS) only for matching mode
ALTER POLICY "Online experts can view nearby broadcast bookings" ON public.bookings
USING (
  (assigned_expert_id IS NULL) AND (status = 'accepted') AND EXISTS (
    SELECT 1 FROM public.experts e
     WHERE e.auth_user_id = auth.uid() AND e.is_online = true AND e.status = 'active'
       AND e.mode = CASE WHEN bookings.is_training THEN 'TRAINING' ELSE 'LIVE' END
       AND (
         (e.current_lat IS NOT NULL AND e.current_lng IS NOT NULL AND bookings.booking_lat IS NOT NULL AND bookings.booking_lng IS NOT NULL
          AND public.haversine_km(e.current_lat, e.current_lng, bookings.booking_lat, bookings.booking_lng)
              <= GREATEST(COALESCE(bookings.current_search_radius_km, 0), COALESCE((SELECT dispatch_config.broadcast_radius_km FROM public.dispatch_config LIMIT 1), 5)))
         OR (e.zone_id IS NOT NULL AND bookings.zone_id IS NOT NULL AND e.zone_id = bookings.zone_id))
       AND (bookings.service_category_id IS NULL OR EXISTS (
         SELECT 1 FROM public.partner_skills ps
          WHERE ps.expert_id = e.id AND ps.status = 'approved' AND ps.service_category_id = bookings.service_category_id))
  )
);

-- No customer messages / admin alerts for training
SELECT public._tm_patch('notify_customer_alert',
  'IF _user_id IS NULL THEN RETURN; END IF;',
  'IF _user_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id AND is_training) THEN RETURN; END IF;');
SELECT public._tm_patch('notify_customer_push',
  'IF _user_id IS NULL THEN RETURN; END IF;',
  'IF _user_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id AND is_training) THEN RETURN; END IF;');
SELECT public._tm_patch('admin_alert_on_booking_paid',
  $r$IF NOT public.admin_alert_enabled('admin_whatsapp_alert_enabled') THEN RETURN NEW; END IF;$r$,
  $r$IF COALESCE(NEW.is_training, false) THEN RETURN NEW; END IF;
  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_enabled') THEN RETURN NEW; END IF;$r$);

-- No money side effects; count training completion
SELECT public._tm_patch('credit_booking_completion',
  'IF _b.assigned_expert_id IS NULL THEN RETURN 0; END IF;',
  $r$IF _b.assigned_expert_id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = _booking_id AND is_training) THEN
    UPDATE public.experts
       SET is_busy = false,
           training_orders_completed = COALESCE(training_orders_completed, 0) + 1
     WHERE id = _b.assigned_expert_id;
    BEGIN
      PERFORM public.notify_expert_alert(
        _b.assigned_expert_id, 'order_completed', 'Training job completed',
        'Well done! Your training job is complete.',
        jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text, 'is_training', true));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN 0;
  END IF;$r$);
SELECT public._tm_patch('bookings_after_complete_referral',
  $r$IF NEW.status = 'completed' AND COALESCE(OLD.status,'') <> 'completed' THEN$r$,
  $r$IF NEW.status = 'completed' AND COALESCE(OLD.status,'') <> 'completed' AND NOT COALESCE(NEW.is_training,false) THEN$r$);
SELECT public._tm_patch('bookings_after_complete_expert_referral',
  'AND NEW.assigned_expert_id IS NOT NULL THEN',
  'AND NEW.assigned_expert_id IS NOT NULL AND NOT COALESCE(NEW.is_training,false) THEN');
SELECT public._tm_patch('bookings_snapshot_commission', '\mBEGIN\M',
  'BEGIN
  IF COALESCE(NEW.is_training, false) THEN
    NEW.snapshot_expert_payout := 0; NEW.snapshot_partner_payout := 0;
    NEW.snapshot_hq_share := 0; NEW.snapshot_hourly_rate := 0; NEW.commission_rule_id := NULL;
    RETURN NEW;
  END IF;', true);

-- Exclude training from reports / payouts / rewards / live counts
SELECT public._tm_patch('staff_dispatch_failure_stats',
  $r$WHERE b.cancellation_reason = 'no_expert_available'$r$,
  $r$WHERE NOT b.is_training AND b.cancellation_reason = 'no_expert_available'$r$);
SELECT public._tm_patch('staff_generate_payout_batch',
  $r$WHERE b.status='completed'$r$, $r$WHERE NOT b.is_training AND b.status='completed'$r$);
SELECT public._tm_patch('expert_rewards_overview',
  $r$WHERE b.status = 'completed'$r$, $r$WHERE NOT b.is_training AND b.status = 'completed'$r$);
SELECT public._tm_patch('reward_check_expert_referral',
  $r$AND status = 'completed';$r$, $r$AND status = 'completed' AND NOT is_training;$r$);
SELECT public._tm_patch('reward_gates_pass',
  $r$AND b.status = 'completed'$r$, $r$AND b.status = 'completed' AND NOT b.is_training$r$);
SELECT public._tm_patch('run_reward_period_jobs',
  $r$b2.status = 'completed'$r$, $r$b2.status = 'completed' AND NOT b2.is_training$r$);
SELECT public._tm_patch('run_reward_period_jobs',
  $r$WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL$r$,
  $r$WHERE b.status = 'completed' AND NOT b.is_training AND b.assigned_expert_id IS NOT NULL$r$);
SELECT public._tm_patch('run_reward_period_jobs',
  $r$WHERE b.status = 'completed' AND b.user_id IS NOT NULL$r$,
  $r$WHERE b.status = 'completed' AND NOT b.is_training AND b.user_id IS NOT NULL$r$);
SELECT public._tm_patch('staff_reward_period_preview',
  $r$b2.status = 'completed'$r$, $r$b2.status = 'completed' AND NOT b2.is_training$r$);
SELECT public._tm_patch('staff_reward_period_preview',
  $r$WHERE b.status = 'completed' AND b.assigned_expert_id IS NOT NULL$r$,
  $r$WHERE b.status = 'completed' AND NOT b.is_training AND b.assigned_expert_id IS NOT NULL$r$);
SELECT public._tm_patch('staff_set_service_focus',
  $r$where status not in ('delivered','cancelled','completed'))$r$,
  $r$where not is_training and status not in ('delivered','cancelled','completed'))$r$);

DROP FUNCTION public._tm_patch(text, text, text, boolean);

-- 6. Internal: create training booking (service_role only; called by edge function)
CREATE OR REPLACE FUNCTION public.training_create_booking(
  _actor uuid, _price_option_id uuid, _scheduled_date date, _scheduled_time_slot text,
  _address jsonb, _expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _addr jsonb; _addr_id uuid; _lat numeric; _lng numeric; _id uuid := gen_random_uuid();
  _e record; _row public.bookings; _s text := public.generate_otp4(); _en text := public.generate_otp4();
BEGIN
  IF _price_option_id IS NULL THEN RAISE EXCEPTION 'service (price_option_id) is required'; END IF;

  IF _address IS NOT NULL AND _address ? 'address_id' THEN
    SELECT id, latitude, longitude INTO _addr_id, _lat, _lng FROM public.addresses WHERE id = (_address->>'address_id')::uuid;
    IF _addr_id IS NULL THEN RAISE EXCEPTION 'Address not found'; END IF;
  ELSE
    _addr := COALESCE(_address, (SELECT value::jsonb FROM public.ops_settings WHERE key = 'training_address'));
    IF _addr IS NULL OR _addr->>'latitude' IS NULL OR _addr->>'longitude' IS NULL THEN
      RAISE EXCEPTION 'Training address is not configured';
    END IF;
    _lat := (_addr->>'latitude')::numeric; _lng := (_addr->>'longitude')::numeric;
    INSERT INTO public.addresses(user_id, label, full_address, area, city, latitude, longitude)
    VALUES (NULL, 'Training', COALESCE(_addr->>'full_address','Training address'), _addr->>'area',
            COALESCE(_addr->>'city','Latur'), _lat, _lng)
    RETURNING id INTO _addr_id;
  END IF;

  IF _expert_id IS NOT NULL THEN
    SELECT id, mode, status, COALESCE(is_busy,false) busy INTO _e FROM public.experts WHERE id = _expert_id FOR UPDATE;
    IF _e.id IS NULL THEN RAISE EXCEPTION 'Expert not found'; END IF;
    IF _e.mode <> 'TRAINING' THEN RAISE EXCEPTION 'MODE_MISMATCH: expert is not in training mode'; END IF;
    IF _e.status <> 'active' THEN RAISE EXCEPTION 'Expert not available'; END IF;
    IF _e.busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;
  END IF;

  PERFORM set_config('app.booking_bypass', 'on', true);
  INSERT INTO public.bookings(id, user_id, address_id, booking_lat, booking_lng, price_option_id,
      slot_type, scheduled_date, scheduled_time_slot, is_training, assigned_expert_id, start_otp, end_otp)
  VALUES (_id, NULL, _addr_id, _lat, _lng, _price_option_id,
      CASE WHEN _scheduled_date IS NOT NULL THEN 'scheduled' ELSE 'now' END,
      _scheduled_date, _scheduled_time_slot, true, _expert_id, _s, _en);

  IF _expert_id IS NOT NULL THEN
    UPDATE public.bookings SET status = 'expert_assigned' WHERE id = _id;
    UPDATE public.experts SET is_busy = true WHERE id = _expert_id;
  END IF;
  PERFORM set_config('app.booking_bypass', 'off', true);

  SELECT * INTO _row FROM public.bookings WHERE id = _id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_actor, 'training_booking_created', 'bookings', _id, NULL,
          jsonb_build_object('expert_id', _expert_id, 'price_option_id', _price_option_id));
  RETURN to_jsonb(_row);
END $$;
REVOKE ALL ON FUNCTION public.training_create_booking(uuid, uuid, date, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_create_booking(uuid, uuid, date, text, jsonb, uuid) TO service_role;

-- 7. Internal: delete training bookings (service_role only)
CREATE OR REPLACE FUNCTION public.training_delete_bookings(
  _actor uuid, _ids uuid[], _from date, _to date, _expert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sel uuid[]; _bad int; _experts uuid[]; _n int; _e uuid;
BEGIN
  IF _ids IS NOT NULL AND array_length(_ids, 1) > 0 THEN
    _sel := _ids;
    SELECT count(*) INTO _bad FROM unnest(_ids) x(id)
      LEFT JOIN public.bookings b ON b.id = x.id
     WHERE b.id IS NULL OR NOT b.is_training;
    IF _bad > 0 THEN
      RAISE EXCEPTION 'NOT_TRAINING: % selected booking(s) are not training bookings or do not exist. Nothing was deleted.', _bad;
    END IF;
  ELSE
    IF _from IS NULL AND _to IS NULL AND _expert_id IS NULL THEN
      RAISE EXCEPTION 'Provide booking ids or at least one filter';
    END IF;
    SELECT array_agg(b.id) INTO _sel FROM public.bookings b
     WHERE b.is_training
       AND (_from IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date >= _from)
       AND (_to IS NULL OR (b.created_at AT TIME ZONE 'Asia/Kolkata')::date <= _to)
       AND (_expert_id IS NULL OR b.assigned_expert_id = _expert_id);
  END IF;

  IF _sel IS NULL OR array_length(_sel,1) IS NULL THEN
    RETURN jsonb_build_object('deleted', 0);
  END IF;

  -- Re-verify under lock
  PERFORM 1 FROM public.bookings WHERE id = ANY(_sel) FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = ANY(_sel) AND NOT is_training) THEN
    RAISE EXCEPTION 'NOT_TRAINING: selection contains a live booking. Nothing was deleted.';
  END IF;

  SELECT array_agg(DISTINCT assigned_expert_id) FILTER (WHERE assigned_expert_id IS NOT NULL)
    INTO _experts FROM public.bookings WHERE id = ANY(_sel);

  -- Related rows (found via foreign keys to bookings)
  DELETE FROM public.referral_transactions WHERE booking_id = ANY(_sel);
  DELETE FROM public.emergency_alerts WHERE booking_id = ANY(_sel);
  DELETE FROM public.payment_intents WHERE booking_id = ANY(_sel);
  DELETE FROM public.coupon_redemptions WHERE booking_id = ANY(_sel);
  DELETE FROM public.support_tickets WHERE booking_id = ANY(_sel);
  DELETE FROM public.booking_price_fallback_log WHERE booking_id = ANY(_sel);
  DELETE FROM public.booking_extensions WHERE booking_id = ANY(_sel);
  DELETE FROM public.booking_tips WHERE booking_id = ANY(_sel);
  DELETE FROM public.dispatch_alert_events WHERE booking_id = ANY(_sel);
  DELETE FROM public.booking_preferred_experts WHERE booking_id = ANY(_sel);
  UPDATE public.vehicles SET booking_id = NULL WHERE booking_id = ANY(_sel);

  DELETE FROM public.bookings WHERE id = ANY(_sel) AND is_training;
  GET DIAGNOSTICS _n = ROW_COUNT;

  -- Free experts whose active job was deleted (training counters untouched)
  IF _experts IS NOT NULL THEN
    FOREACH _e IN ARRAY _experts LOOP
      UPDATE public.experts x SET is_busy =
        EXISTS (SELECT 1 FROM public.bookings b WHERE b.assigned_expert_id = x.id AND b.deleted_at IS NULL
                 AND b.status IN ('expert_assigned','on_the_way','arrived','in_progress'))
        OR EXISTS (SELECT 1 FROM public.courier_orders c WHERE c.assigned_expert_id = x.id
                 AND c.status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT'))
      WHERE x.id = _e;
    END LOOP;
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_actor, 'training_bookings_deleted', 'bookings', NULL, NULL,
          jsonb_build_object('deleted_count', _n, 'booking_ids', to_jsonb(_sel),
                             'filters', jsonb_build_object('from', _from, 'to', _to, 'expert_id', _expert_id)));
  RETURN jsonb_build_object('deleted', _n);
END $$;
REVOKE ALL ON FUNCTION public.training_delete_bookings(uuid, uuid[], date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_delete_bookings(uuid, uuid[], date, date, uuid) TO service_role;

-- 8. Internal: set expert mode (service_role only)
CREATE OR REPLACE FUNCTION public.training_set_expert_mode(_actor uuid, _expert_id uuid, _mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _old text; _row public.experts;
BEGIN
  IF _mode NOT IN ('TRAINING','LIVE') THEN RAISE EXCEPTION 'mode must be TRAINING or LIVE'; END IF;
  SELECT mode INTO _old FROM public.experts WHERE id = _expert_id FOR UPDATE;
  IF _old IS NULL THEN RAISE EXCEPTION 'Expert not found'; END IF;
  UPDATE public.experts
     SET mode = _mode,
         training_completed_at = CASE WHEN _mode = 'LIVE' AND _old <> 'LIVE' THEN now() ELSE training_completed_at END
   WHERE id = _expert_id RETURNING * INTO _row;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_actor, 'expert_mode_changed', 'experts', _expert_id,
          jsonb_build_object('mode', _old), jsonb_build_object('mode', _mode));
  RETURN jsonb_build_object('id', _row.id, 'mode', _row.mode,
    'training_orders_completed', _row.training_orders_completed, 'training_completed_at', _row.training_completed_at);
END $$;
REVOKE ALL ON FUNCTION public.training_set_expert_mode(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_set_expert_mode(uuid, uuid, text) TO service_role;
