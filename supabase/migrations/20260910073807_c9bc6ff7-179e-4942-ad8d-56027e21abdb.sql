CREATE TABLE public.booking_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  expert_id uuid REFERENCES public.experts(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  razorpay_payment_id text,
  status text NOT NULL DEFAULT 'paid',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX booking_tips_payment_uniq ON public.booking_tips (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX booking_tips_booking_idx ON public.booking_tips (booking_id);

GRANT SELECT ON public.booking_tips TO authenticated;
GRANT ALL ON public.booking_tips TO service_role;

ALTER TABLE public.booking_tips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers read own tips"
  ON public.booking_tips FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages tips"
  ON public.booking_tips FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at_booking_tips()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER booking_tips_updated_at BEFORE UPDATE ON public.booking_tips
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_booking_tips();

-- Records a paid tip and credits the expert's wallet. Callable by the paying customer.
CREATE OR REPLACE FUNCTION public.record_booking_tip(
  _booking_id uuid,
  _amount numeric,
  _razorpay_payment_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_expert uuid;
  v_user uuid;
  v_tip uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 OR _amount > 5000 THEN
    RAISE EXCEPTION 'Invalid tip amount';
  END IF;

  SELECT b.assigned_expert_id, b.user_id INTO v_expert, v_user
    FROM public.bookings b
   WHERE b.id = _booking_id AND b.user_id = auth.uid();

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  SELECT id INTO v_tip FROM public.booking_tips
   WHERE razorpay_payment_id IS NOT NULL AND razorpay_payment_id = _razorpay_payment_id;
  IF v_tip IS NOT NULL THEN
    RETURN v_tip;
  END IF;

  INSERT INTO public.booking_tips (booking_id, expert_id, user_id, amount, razorpay_payment_id, status)
  VALUES (_booking_id, v_expert, v_user, _amount, _razorpay_payment_id, 'paid')
  RETURNING id INTO v_tip;

  IF v_expert IS NOT NULL THEN
    INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason, created_by)
    VALUES ('expert', v_expert, _amount, 'credit', 'Customer tip', v_user);

    UPDATE public.experts
       SET wallet_balance = COALESCE(wallet_balance, 0) + _amount
     WHERE id = v_expert;
  END IF;

  RETURN v_tip;
END; $$;

GRANT EXECUTE ON FUNCTION public.record_booking_tip(uuid, numeric, text) TO authenticated;

-- Expert public profile including average rating for a booking the caller owns.
CREATE OR REPLACE FUNCTION public.get_assigned_expert_profile(_booking_id uuid)
RETURNS TABLE(id uuid, name text, phone text, photo_url text, avg_rating numeric, review_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.name, e.phone, e.photo_url,
         ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
         COUNT(r.rating)::int AS review_count
    FROM public.bookings b
    JOIN public.experts e ON e.id = b.assigned_expert_id
    LEFT JOIN public.bookings r
           ON r.assigned_expert_id = e.id AND r.rating IS NOT NULL
   WHERE b.id = _booking_id
     AND b.user_id = auth.uid()
   GROUP BY e.id, e.name, e.phone, e.photo_url;
$$;

GRANT EXECUTE ON FUNCTION public.get_assigned_expert_profile(uuid) TO authenticated;

INSERT INTO public.homepage_sections (section_type, display_order, is_active, payload)
VALUES (
  'inprogress_banner', 50, false,
  jsonb_build_object(
    'title', 'Refer & Earn',
    'subtitle', 'You get ₹200, your friend gets ₹50',
    'button_label', 'Refer now',
    'cta_action', 'navigate:referrals',
    'image_url', ''
  )
);