-- 1. Respect the dispatch lead window when auto-accepting after payment.
CREATE OR REPLACE FUNCTION public.system_accept_booking_after_payment(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _current text;
  _owner uuid;
  _payment_id text;
  _before jsonb;
  _after jsonb;
  _slot timestamptz;
  _lead int;
  _hold boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT to_jsonb(b), b.status, b.user_id, b.razorpay_payment_id,
         public.slot_start_ist(b.scheduled_date, b.scheduled_time_slot)
    INTO _before, _current, _owner, _payment_id, _slot
    FROM public.bookings b WHERE b.id = _booking_id;

  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _payment_id IS NULL OR length(_payment_id) = 0 THEN RAISE EXCEPTION 'Payment not verified'; END IF;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES (_uid, 'system_payment_confirmed', 'bookings', _booking_id,
          NULL,
          _before || jsonb_build_object('actor_role','system'));

  _lead := public.get_ops_num('booking_dispatch_lead_minutes', 60)::int;
  _hold := _slot IS NOT NULL AND _slot > now() + make_interval(mins => _lead);

  IF _hold THEN
    -- Scheduled far ahead: stay 'confirmed'. booking_dispatch_release_due()
    -- promotes it to 'accepted' exactly `_lead` minutes before the slot.
    INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (_uid, 'system_dispatch_held', 'bookings', _booking_id, NULL,
            jsonb_build_object('actor_role','system','slot_start_at', _slot,
                               'dispatch_lead_minutes', _lead,
                               'release_at', _slot - make_interval(mins => _lead)));
    RETURN;
  END IF;

  IF _current = 'confirmed' THEN
    PERFORM set_config('app.booking_bypass','on', true);
    UPDATE public.bookings SET status = 'accepted' WHERE id = _booking_id;
    PERFORM set_config('app.booking_bypass','off', true);

    SELECT to_jsonb(b) INTO _after FROM public.bookings b WHERE id = _booking_id;

    INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
    VALUES (_uid, 'system_auto_accept', 'bookings', _booking_id,
            _before || jsonb_build_object('actor_role','system'),
            _after  || jsonb_build_object('actor_role','system'));
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.system_accept_booking_after_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.system_accept_booking_after_payment(uuid) TO authenticated;

-- 2. Put the wrongly-dispatched scheduled booking back into the holding state.
DO $do$
DECLARE _b record; _before jsonb;
BEGIN
  SELECT * INTO _b FROM public.bookings
   WHERE id = '6ffdadff-0456-4273-91a4-97ac45916b4b';
  IF _b.id IS NULL THEN RETURN; END IF;
  IF _b.status IN ('completed','cancelled','in_progress') THEN RETURN; END IF;

  _before := to_jsonb(_b);
  PERFORM set_config('app.booking_bypass','on', true);
  UPDATE public.bookings
     SET status = 'confirmed',
         assigned_expert_id = NULL,
         expert_assigned_at = NULL,
         on_the_way_at = NULL,
         arrived_at = NULL,
         onway_alert_sent = false,
         broadcast_started_at = NULL,
         current_search_radius_km = NULL,
         updated_at = now()
   WHERE id = _b.id;
  PERFORM set_config('app.booking_bypass','off', true);

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, before_state, after_state)
  VALUES ('00000000-0000-0000-0000-000000000000', 'system_rehold_scheduled_booking',
          'bookings', _b.id, _before,
          (SELECT to_jsonb(x) FROM public.bookings x WHERE x.id = _b.id)
            || jsonb_build_object('actor_role','system','reason','dispatched before lead window'));
END $do$;