
CREATE OR REPLACE FUNCTION public.system_credit_referral_for_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _buyer uuid; _booking_status text;
  _first_count integer; _txn_id uuid; _referrer_id uuid;
  _is_active boolean; _reward numeric;
BEGIN
  SELECT user_id, status INTO _buyer, _booking_status
    FROM public.bookings WHERE id = _booking_id;
  IF _buyer IS NULL THEN RETURN; END IF;
  IF _booking_status NOT IN ('confirmed','accepted','expert_assigned','in_progress','completed') THEN
    RETURN;
  END IF;

  SELECT count(*) INTO _first_count FROM public.bookings
    WHERE user_id = _buyer
      AND status IN ('pending','confirmed','accepted','expert_assigned','in_progress','completed');
  IF _first_count <> 1 THEN RETURN; END IF;

  -- Idempotent: only an un-credited, un-booked pending referral qualifies.
  SELECT id, referrer_id INTO _txn_id, _referrer_id
    FROM public.referral_transactions
   WHERE referred_user_id = _buyer AND status = 'pending' AND booking_id IS NULL
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE;
  IF _txn_id IS NULL THEN RETURN; END IF;

  SELECT is_active, reward_coins INTO _is_active, _reward
    FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _is_active IS NOT TRUE THEN RETURN; END IF;
  _reward := COALESCE(_reward, 0);

  UPDATE public.referral_transactions
     SET status='reward_credited', reward_amount=_reward, reward_date=now(), booking_id=_booking_id
   WHERE id = _txn_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users
     SET total_coins_earned = COALESCE(total_coins_earned,0) + _reward::int,
         successful_referrals = COALESCE(successful_referrals,0) + 1
   WHERE id = _referrer_id;
  PERFORM set_config('app.users_bypass', 'off', true);

  INSERT INTO public.wallet_transactions (user_id, amount, type, description)
    VALUES (_referrer_id, _reward, 'credit', 'Referral Reward');

  PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
    'Referral reward credited',
    'Your friend completed their first booking. You earned ' || _reward::text || ' coins.',
    jsonb_build_object('route','refer-earn'));

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_first_booking', _txn_id::text,
    jsonb_build_object('booking_id', _booking_id, 'referred_user_id', _buyer));
END;
$function$;

REVOKE ALL ON FUNCTION public.system_credit_referral_for_booking(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_credit_referral_for_booking(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.credit_referral_for_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT user_id INTO _owner FROM public.bookings WHERE id = _booking_id;
  IF _owner IS NULL OR _owner <> _uid THEN RETURN; END IF;
  PERFORM public.system_credit_referral_for_booking(_booking_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_fulfill_payment_intent(_order_id text, _payment_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_intent public.payment_intents%ROWTYPE;
  v_booking_id uuid;
  v_p jsonb;
BEGIN
  SELECT * INTO v_intent FROM public.payment_intents
   WHERE razorpay_order_id = _order_id FOR UPDATE;

  SELECT id INTO v_booking_id FROM public.bookings
   WHERE razorpay_order_id = _order_id
      OR (_payment_id IS NOT NULL AND razorpay_payment_id = _payment_id)
   LIMIT 1;

  IF v_booking_id IS NOT NULL THEN
    IF v_intent.id IS NOT NULL THEN
      UPDATE public.payment_intents
         SET status = 'fulfilled', booking_id = v_booking_id,
             razorpay_payment_id = COALESCE(_payment_id, razorpay_payment_id)
       WHERE id = v_intent.id;
    END IF;
    RETURN v_booking_id;
  END IF;

  IF v_intent.id IS NULL THEN
    INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, after_state)
    VALUES ('00000000-0000-0000-0000-000000000000', 'system_payment_without_intent',
            'payment_intents', NULL,
            jsonb_build_object('razorpay_order_id', _order_id, 'razorpay_payment_id', _payment_id));
    RETURN NULL;
  END IF;

  v_p := v_intent.payload;

  BEGIN
    INSERT INTO public.bookings (
      user_id, address_id, service_duration_minutes, service_label, price,
      slot_type, scheduled_date, scheduled_time_slot, status,
      razorpay_order_id, razorpay_payment_id, booking_lat, booking_lng
    ) VALUES (
      v_intent.user_id,
      NULLIF(v_p->>'address_id','')::uuid,
      COALESCE((v_p->>'service_duration_minutes')::int, 0),
      COALESCE(v_p->>'service_label', 'Service'),
      v_intent.amount / 100.0,
      COALESCE(v_p->>'slot_type', 'now'),
      NULLIF(v_p->>'scheduled_date','')::date,
      NULLIF(v_p->>'scheduled_time_slot',''),
      'confirmed',
      _order_id,
      _payment_id,
      NULLIF(v_p->>'booking_lat','')::double precision,
      NULLIF(v_p->>'booking_lng','')::double precision
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.payment_intents
       SET attempts = attempts + 1,
           last_error = SQLERRM,
           status = CASE WHEN attempts + 1 >= 3 THEN 'needs_staff_attention' ELSE status END,
           alerted_at = CASE WHEN attempts + 1 >= 3 THEN now() ELSE alerted_at END
     WHERE id = v_intent.id;

    IF v_intent.attempts + 1 >= 3 THEN
      INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, after_state)
      VALUES ('00000000-0000-0000-0000-000000000000', 'system_paid_booking_recovery_failed',
              'payment_intents', v_intent.id,
              jsonb_build_object('razorpay_order_id', _order_id,
                                 'razorpay_payment_id', _payment_id,
                                 'error', SQLERRM));
    END IF;
    RETURN NULL;
  END;

  UPDATE public.payment_intents
     SET status = 'fulfilled', booking_id = v_booking_id, razorpay_payment_id = _payment_id
   WHERE id = v_intent.id;

  -- Credit the referral BEFORE auto-accept (which changes the booking status).
  BEGIN
    PERFORM public.system_credit_referral_for_booking(v_booking_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM public.system_accept_booking_after_payment(v_booking_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, after_state)
  VALUES ('00000000-0000-0000-0000-000000000000', 'system_booking_recovered_from_payment',
          'bookings', v_booking_id,
          jsonb_build_object('razorpay_order_id', _order_id, 'razorpay_payment_id', _payment_id));

  RETURN v_booking_id;
END;
$function$;
