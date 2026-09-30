DROP POLICY IF EXISTS "staff read booking price fallback log" ON public.booking_price_fallback_log;
CREATE POLICY "staff read booking price fallback log"
  ON public.booking_price_fallback_log FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));

CREATE OR REPLACE FUNCTION public.system_fulfill_payment_intent(_order_id text, _payment_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
      user_id, address_id, price_option_id, service_duration_minutes, service_label, price,
      slot_type, scheduled_date, scheduled_time_slot, status,
      razorpay_order_id, razorpay_payment_id, booking_lat, booking_lng
    ) VALUES (
      v_intent.user_id,
      NULLIF(v_p->>'address_id','')::uuid,
      COALESCE(NULLIF(v_p->>'price_option_id','')::uuid, NULLIF(v_p->>'item_id','')::uuid),
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
$fn$;