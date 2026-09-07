CREATE TABLE public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  razorpay_order_id text not null unique,
  razorpay_payment_id text,
  amount integer not null,
  currency text not null default 'INR',
  payload jsonb not null,
  status text not null default 'pending',
  booking_id uuid references public.bookings(id) on delete set null,
  attempts integer not null default 0,
  last_error text,
  alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT ON public.payment_intents TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own payment intents"
  ON public.payment_intents FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_payment_intents_updated_at
  BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX payment_intents_status_idx ON public.payment_intents (status);

CREATE UNIQUE INDEX bookings_razorpay_order_id_key
  ON public.bookings (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.system_fulfill_payment_intent(
  _order_id text,
  _payment_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  BEGIN
    PERFORM public.system_accept_booking_after_payment(v_booking_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM public.credit_referral_for_booking(v_booking_id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.audit_logs (actor_id, action, target_table, target_id, after_state)
  VALUES ('00000000-0000-0000-0000-000000000000', 'system_booking_recovered_from_payment',
          'bookings', v_booking_id,
          jsonb_build_object('razorpay_order_id', _order_id, 'razorpay_payment_id', _payment_id));

  RETURN v_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.system_fulfill_payment_intent(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.system_fulfill_payment_intent(text, text) TO service_role;