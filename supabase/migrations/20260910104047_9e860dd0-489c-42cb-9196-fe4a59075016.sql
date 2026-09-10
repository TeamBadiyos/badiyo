-- 1. Single source of truth for customer booking alerts
CREATE OR REPLACE FUNCTION public.notify_customer_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _title text; _body text; _alert text; _expert text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'expert_assigned' THEN
    SELECT name INTO _expert FROM public.experts WHERE id = NEW.assigned_expert_id;
    _alert := 'expert_assigned';
    _title := 'Expert assigned!';
    _body  := COALESCE(_expert, 'Your expert') || ' is on the way for '
              || COALESCE(NEW.service_label, 'your booking') || '.';
  ELSIF NEW.status = 'in_progress' THEN
    _alert := 'service_started';
    _title := 'Service started';
    _body  := 'Your service has started. Estimated duration: '
              || COALESCE(NEW.service_duration_minutes, 60)::text
              || ' minutes — we''ll notify you when it''s done.';
  ELSIF NEW.status = 'completed' THEN
    _alert := 'order_completed';
    _title := 'Service completed';
    _body  := 'Your booking is complete! Please rate your experience.';
  ELSIF NEW.status = 'cancelled' THEN
    _alert := 'booking_cancelled';
    _title := 'Booking cancelled';
    _body  := COALESCE(NEW.cancellation_reason, 'Your booking has been cancelled.');
  ELSIF NEW.status = 'accepted' THEN
    _alert := 'booking_confirmed';
    _title := 'Booking confirmed';
    _body  := 'We are finding an expert for you.';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.notify_customer_alert(
    NEW.id, _alert, _title, _body,
    jsonb_build_object(
      'route', CASE WHEN NEW.status = 'cancelled'
                    THEN 'my-bookings'
                    ELSE 'booking/' || NEW.id::text END,
      'status', NEW.status
    )
  );
  RETURN NEW;
END $function$;

-- 2. Booking placed alert (insert path; the trigger above only covers updates)
CREATE OR REPLACE FUNCTION public.notify_customer_booking_placed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('accepted','confirmed','pending') THEN RETURN NEW; END IF;

  PERFORM public.notify_customer_alert(
    NEW.id, 'booking_placed', 'Booking placed',
    'We received your booking for ' || COALESCE(NEW.service_label, 'your service')
      || '. We are finding an expert for you.',
    jsonb_build_object('route', 'booking/' || NEW.id::text, 'status', NEW.status)
  );
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_customer_booking_placed ON public.bookings;
CREATE TRIGGER trg_notify_customer_booking_placed
AFTER INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.notify_customer_booking_placed();

-- 3. Remove the duplicate customer sends from the actions that change status
CREATE OR REPLACE FUNCTION public.claim_booking_as_expert(p_booking_id uuid)
RETURNS bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_expert_id uuid; v_exp_lat numeric; v_exp_lng numeric; v_is_busy boolean;
  v_bk_lat numeric; v_bk_lng numeric; v_radius numeric; v_distance numeric;
  v_current_status text; v_current_assigned uuid; v_cat uuid;
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

  SELECT broadcast_radius_km INTO v_radius FROM public.dispatch_config LIMIT 1;
  IF v_radius IS NULL THEN v_radius := 5; END IF;

  SELECT booking_lat, booking_lng, status, assigned_expert_id, service_category_id
    INTO v_bk_lat, v_bk_lng, v_current_status, v_current_assigned, v_cat
    FROM public.bookings WHERE id = p_booking_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_bk_lat IS NULL OR v_bk_lng IS NULL THEN
    RAISE EXCEPTION 'You are outside the service radius for this booking.';
  END IF;

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

  -- Customer alert is sent once by trg_notify_customer_status_change.
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_assign_expert(_booking_id uuid, _expert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _expert_ok boolean; _expert_busy boolean; _expert_name text;
  _before jsonb; _after jsonb; _current_status text; _current_expert uuid; _updated_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(auth.uid(), array['super_admin','ops_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  SELECT (status = 'active'), COALESCE(is_busy,false), name
    INTO _expert_ok, _expert_busy, _expert_name
    FROM public.experts WHERE id = _expert_id FOR UPDATE;
  IF NOT COALESCE(_expert_ok, false) THEN RAISE EXCEPTION 'Expert not available'; END IF;
  IF _expert_busy THEN RAISE EXCEPTION 'Expert already has an active booking'; END IF;

  SELECT status, assigned_expert_id INTO _current_status, _current_expert
    FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _current_status IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  SELECT to_jsonb(b) INTO _before FROM public.bookings b WHERE id = _booking_id;

  PERFORM set_config('app.booking_bypass', 'on', true);
  UPDATE public.bookings
     SET assigned_expert_id = _expert_id, status = 'expert_assigned'
   WHERE id = _booking_id AND status = 'accepted' AND assigned_expert_id IS NULL;
  GET DIAGNOSTICS _updated_count = ROW_COUNT;
  PERFORM set_config('app.booking_bypass', 'off', true);

  IF _updated_count = 0 THEN RAISE EXCEPTION 'This booking has already been assigned'; END IF;

  UPDATE public.experts SET is_busy = true WHERE id = _expert_id;

  SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'assigned_by_staff', 'bookings', _booking_id, _before, _after);
  -- Customer alert is sent once by trg_notify_customer_status_change.
END;
$function$;

CREATE OR REPLACE FUNCTION public.expert_verify_start_otp(_booking_id uuid, _otp text)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record; _end timestamptz; _duration int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, start_otp, service_duration_minutes, service_end_at, end_otp
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;
  IF _b.status = 'in_progress' THEN RETURN _b.service_end_at; END IF;
  IF _b.status <> 'expert_assigned' THEN RAISE EXCEPTION 'Booking not ready to start'; END IF;
  IF _b.start_otp IS NULL OR btrim(_otp) <> _b.start_otp THEN RAISE EXCEPTION 'Invalid start OTP'; END IF;

  _duration := COALESCE(_b.service_duration_minutes, 60);
  _end := now() + make_interval(mins => _duration);

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'in_progress', started_at = now(), service_end_at = _end,
         end_otp = COALESCE(end_otp, public.generate_otp4())
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  -- Customer alert is sent once by trg_notify_customer_status_change.
  RETURN _end;
END $function$;

CREATE OR REPLACE FUNCTION public.expert_verify_end_otp(_booking_id uuid, _otp text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _expert_id uuid; _b record; _payout numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  _expert_id := public.get_expert_id_for_auth(auth.uid());
  IF _expert_id IS NULL THEN RAISE EXCEPTION 'Not an expert'; END IF;
  IF _otp IS NULL OR btrim(_otp) = '' THEN RAISE EXCEPTION 'OTP required'; END IF;

  SELECT id, assigned_expert_id, status, end_otp, service_duration_minutes, user_id, price
    INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF _b.assigned_expert_id <> _expert_id THEN RAISE EXCEPTION 'Not your booking'; END IF;

  SELECT r.expert_payout INTO _payout FROM public.resolve_booking_payouts(_booking_id) r;
  _payout := COALESCE(_payout, 0);

  IF _b.status = 'completed' THEN RETURN _payout; END IF;
  IF _b.status <> 'in_progress' THEN RAISE EXCEPTION 'Booking not in progress'; END IF;
  IF _b.end_otp IS NULL OR btrim(_otp) <> _b.end_otp THEN RAISE EXCEPTION 'Invalid end OTP'; END IF;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'completed', service_end_at = COALESCE(service_end_at, now()), updated_at = now()
   WHERE id = _booking_id;
  PERFORM set_config('app.booking_bypass','off', true);

  UPDATE public.experts SET is_busy = false WHERE id = _expert_id;

  IF _payout > 0 AND NOT EXISTS (
       SELECT 1 FROM public.wallet_ledger
        WHERE owner_type='expert' AND owner_id=_expert_id
          AND reason = 'Booking payout: ' || _booking_id::text) THEN
    INSERT INTO public.wallet_ledger(owner_type, owner_id, amount, type, reason, created_by)
    VALUES('expert', _expert_id, _payout, 'credit', 'Booking payout: ' || _booking_id::text, NULL);
    UPDATE public.experts SET wallet_balance = COALESCE(wallet_balance,0) + _payout WHERE id = _expert_id;
  END IF;

  PERFORM public.evaluate_reward_triggers('partner', _expert_id, 'booking_completed', _booking_id::text,
    jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0),
                       'minutes', COALESCE(_b.service_duration_minutes,0)));
  IF _b.user_id IS NOT NULL THEN
    PERFORM public.evaluate_reward_triggers('customer', _b.user_id, 'booking_completed', _booking_id::text,
      jsonb_build_object('booking_id', _booking_id, 'amount', COALESCE(_b.price,0)));
  END IF;

  -- Customer alert (order_completed) is sent once by trg_notify_customer_status_change.
  PERFORM public.notify_expert_alert(
    _expert_id, 'order_completed', 'Job completed',
    'You completed the job. ₹' || _payout::text || ' has been credited to your wallet.',
    jsonb_build_object('booking_id', _booking_id, 'route', 'booking/' || _booking_id::text)
  );

  RETURN _payout;
END $function$;

-- 4. Extension: real catalogue pricing + a "waiting for expert" alert for the customer
CREATE OR REPLACE FUNCTION public.extend_booking(_booking_id uuid, _extra_minutes integer, _razorpay_payment_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid; _status text; _end timestamptz; _price numeric;
  _assigned uuid; _ext_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _extra_minutes IS NULL OR _extra_minutes <= 0 THEN
    RAISE EXCEPTION 'Invalid extension duration';
  END IF;
  SELECT user_id, status, service_end_at, assigned_expert_id
    INTO _owner, _status, _end, _assigned
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

  SELECT price INTO _price FROM public.service_catalogue_config
    WHERE duration_minutes = _extra_minutes AND is_active = true
    ORDER BY created_at DESC LIMIT 1;

  IF _price IS NULL THEN
    -- Fall back to the live service catalogue so extensions work for any duration.
    SELECT spo.customer_price INTO _price
      FROM public.service_price_options spo
      JOIN public.services s ON s.id = spo.service_id
     WHERE spo.duration_minutes = _extra_minutes
       AND spo.is_active = true
       AND s.is_active = true
     ORDER BY spo.customer_price ASC
     LIMIT 1;
  END IF;

  IF _price IS NULL THEN RAISE EXCEPTION 'Extension duration not available'; END IF;

  INSERT INTO public.booking_extensions(booking_id, extra_minutes, price, razorpay_payment_id, approval_status)
    VALUES(_booking_id, _extra_minutes, _price, NULLIF(btrim(_razorpay_payment_id), ''), 'pending')
    RETURNING id INTO _ext_id;

  IF _assigned IS NOT NULL THEN
    PERFORM public.notify_expert_alert(
      _assigned, 'extension_request', 'Extension requested',
      'Customer requested ' || _extra_minutes::text || ' more minutes (₹' || _price::text || ').',
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
END $function$;

-- 5. Tip alert for the expert
CREATE OR REPLACE FUNCTION public.record_booking_tip(_booking_id uuid, _amount numeric, _razorpay_payment_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_expert uuid;
  v_tip_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _amount IS NULL OR _amount NOT IN (25, 50, 100) THEN RAISE EXCEPTION 'Invalid tip amount'; END IF;
  IF _razorpay_payment_id IS NULL OR length(trim(_razorpay_payment_id)) = 0 THEN
    RAISE EXCEPTION 'Missing payment reference';
  END IF;

  SELECT assigned_expert_id INTO v_expert
  FROM public.bookings WHERE id = _booking_id AND user_id = v_uid;

  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_expert IS NULL THEN RAISE EXCEPTION 'No expert assigned'; END IF;

  SELECT id INTO v_tip_id FROM public.booking_tips
  WHERE razorpay_payment_id = _razorpay_payment_id;
  IF v_tip_id IS NOT NULL THEN RETURN v_tip_id; END IF;

  INSERT INTO public.booking_tips (booking_id, expert_id, user_id, amount, razorpay_payment_id, status)
  VALUES (_booking_id, v_expert, v_uid, _amount, _razorpay_payment_id, 'paid')
  RETURNING id INTO v_tip_id;

  UPDATE public.experts
  SET wallet_balance = COALESCE(wallet_balance, 0) + _amount
  WHERE id = v_expert;

  INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason, created_by)
  VALUES ('expert', v_expert, _amount, 'credit', 'Customer tip', v_uid);

  PERFORM public.notify_expert_alert(
    v_expert, 'tip_received', 'You received a tip!',
    'A customer tipped you ₹' || _amount::text || '. It has been added to your wallet.',
    jsonb_build_object('booking_id', _booking_id, 'amount', _amount,
      'route', 'booking/' || _booking_id::text)
  );

  RETURN v_tip_id;
END;
$function$;

-- 6. Same-day reminder for scheduled bookings (hourly, fires once in the 07:00 IST hour)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS scheduled_reminder_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dispatch_alert_sent boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.send_scheduled_booking_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _r record; _count integer := 0;
BEGIN
  IF EXTRACT(HOUR FROM (now() AT TIME ZONE 'Asia/Kolkata')) <> 7 THEN
    RETURN 0;
  END IF;

  FOR _r IN
    SELECT id, scheduled_time_slot, service_label
      FROM public.bookings
     WHERE deleted_at IS NULL
       AND scheduled_reminder_sent = false
       AND slot_type = 'scheduled'
       AND scheduled_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND status IN ('accepted','confirmed','pending','expert_assigned')
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.notify_customer_alert(
      _r.id, 'scheduled_reminder', 'Service scheduled today',
      COALESCE(_r.service_label, 'Your service') || ' is scheduled for today'
        || COALESCE(' (' || _r.scheduled_time_slot || ')', '') || '.',
      jsonb_build_object('route', 'booking/' || _r.id::text)
    );
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET scheduled_reminder_sent = true WHERE id = _r.id;
    PERFORM set_config('app.booking_bypass','off', true);
    _count := _count + 1;
  END LOOP;
  RETURN _count;
END $function$;

SELECT cron.schedule('scheduled-booking-reminders', '5 * * * *',
  $$SELECT public.send_scheduled_booking_reminders();$$);

-- 7. "No expert found" alert, folded into the existing dispatch job (no new job)
CREATE OR REPLACE FUNCTION public.expand_stale_broadcasts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
  b record;
  _new_radius numeric;
  _expanded integer := 0;
BEGIN
  SELECT * INTO cfg FROM public.dispatch_config LIMIT 1;
  IF cfg.id IS NULL THEN RETURN 0; END IF;

  FOR b IN
    SELECT id, COALESCE(current_search_radius_km, cfg.broadcast_radius_km) AS radius
    FROM public.bookings
    WHERE status = 'accepted'
      AND assigned_expert_id IS NULL
      AND deleted_at IS NULL
      AND broadcast_started_at IS NOT NULL
      AND broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
      AND COALESCE(current_search_radius_km, cfg.broadcast_radius_km) < cfg.radius_expand_max_km
  LOOP
    _new_radius := LEAST(b.radius + cfg.radius_expand_step_km, cfg.radius_expand_max_km);
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET current_search_radius_km = _new_radius WHERE id = b.id;
    PERFORM set_config('app.booking_bypass','off', true);
    PERFORM public.broadcast_booking_to_experts(b.id, _new_radius);
    _expanded := _expanded + 1;
  END LOOP;

  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET dispatch_exhausted_at = now()
   WHERE status = 'accepted'
     AND assigned_expert_id IS NULL
     AND deleted_at IS NULL
     AND dispatch_exhausted_at IS NULL
     AND broadcast_started_at IS NOT NULL
     AND broadcast_started_at < now() - make_interval(secs => cfg.radius_expand_after_seconds)
     AND COALESCE(current_search_radius_km, cfg.broadcast_radius_km) >= cfg.radius_expand_max_km;
  PERFORM set_config('app.booking_bypass','off', true);

  FOR b IN
    SELECT id FROM public.bookings
     WHERE deleted_at IS NULL
       AND dispatch_alert_sent = false
       AND dispatch_exhausted_at IS NOT NULL
       AND assigned_expert_id IS NULL
       AND status IN ('accepted','confirmed','pending')
  LOOP
    PERFORM public.notify_customer_alert(
      b.id, 'no_expert_found', 'Still looking for an expert',
      'No expert is available near you right now. We are still trying — you can also cancel for a full refund.',
      jsonb_build_object('route', 'booking/' || b.id::text)
    );
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET dispatch_alert_sent = true WHERE id = b.id;
    PERFORM set_config('app.booking_bypass','off', true);
  END LOOP;

  RETURN _expanded;
END;
$function$;