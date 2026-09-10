CREATE OR REPLACE FUNCTION public.record_booking_tip(_booking_id uuid, _amount numeric, _razorpay_payment_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_expert uuid;
  v_tip_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _amount IS NULL OR _amount NOT IN (25, 50, 100) THEN
    RAISE EXCEPTION 'Invalid tip amount';
  END IF;

  IF _razorpay_payment_id IS NULL OR length(trim(_razorpay_payment_id)) = 0 THEN
    RAISE EXCEPTION 'Missing payment reference';
  END IF;

  SELECT assigned_expert_id INTO v_expert
  FROM public.bookings
  WHERE id = _booking_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
  IF v_expert IS NULL THEN
    RAISE EXCEPTION 'No expert assigned';
  END IF;

  -- Idempotent: the same Razorpay payment can only ever create one tip.
  SELECT id INTO v_tip_id FROM public.booking_tips
  WHERE razorpay_payment_id = _razorpay_payment_id;
  IF v_tip_id IS NOT NULL THEN
    RETURN v_tip_id;
  END IF;

  INSERT INTO public.booking_tips (booking_id, expert_id, user_id, amount, razorpay_payment_id, status)
  VALUES (_booking_id, v_expert, v_uid, _amount, _razorpay_payment_id, 'paid')
  RETURNING id INTO v_tip_id;

  UPDATE public.experts
  SET wallet_balance = COALESCE(wallet_balance, 0) + _amount
  WHERE id = v_expert;

  INSERT INTO public.wallet_ledger (owner_type, owner_id, amount, type, reason, created_by)
  VALUES ('expert', v_expert, _amount, 'credit', 'Customer tip', v_uid);

  RETURN v_tip_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_booking_tip(uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_booking_tip(uuid, numeric, text) TO authenticated;