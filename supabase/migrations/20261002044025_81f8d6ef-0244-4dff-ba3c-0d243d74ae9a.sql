
CREATE OR REPLACE FUNCTION public.system_coupon_reserve(_user_id uuid, _code text, _base_amount numeric, _duration_minutes integer, _order_id text, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q jsonb;
BEGIN
  -- A new checkout supersedes any earlier unfinished one: free its coupon hold.
  UPDATE public.coupon_redemptions r
     SET status = 'released', updated_at = now()
   WHERE r.user_id = _user_id AND r.status = 'reserved' AND r.booking_id IS NULL
     AND r.razorpay_order_id IS DISTINCT FROM _order_id
     AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.razorpay_order_id = r.razorpay_order_id);
  q := public.coupon_quote(_user_id, _code, _base_amount, _duration_minutes, _category_id);
  IF (q->>'ok')::boolean IS NOT TRUE THEN RETURN q; END IF;
  INSERT INTO public.coupon_redemptions (coupon_id, user_id, razorpay_order_id, discount_amount, base_amount, status)
  VALUES ((q->>'coupon_id')::uuid, _user_id, _order_id, (q->>'discount')::numeric, COALESCE(_base_amount,0), 'reserved');
  RETURN q;
END; $$;
REVOKE ALL ON FUNCTION public.system_coupon_reserve(uuid, text, numeric, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_coupon_reserve(uuid, text, numeric, integer, text, uuid) TO service_role;

-- Per-user limit counts only coupons actually used on a real booking.
DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p WHERE proname='coupon_quote_core';
  src := replace(src, $q$AND user_id = _user_id AND status IN ('reserved','applied');$q$, $q$AND user_id = _user_id AND status = 'applied';$q$);
  EXECUTE src;
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p WHERE proname='my_coupons';
  src := replace(src, $q$r.status IN ('reserved','applied')$q$, $q$r.status = 'applied'$q$);
  EXECUTE src;
END $$;

-- Unlock Shashi Jain's stuck hold (no booking exists for this order).
UPDATE public.coupon_redemptions SET status='released', updated_at=now()
 WHERE id='db78707e-25f4-4c69-86f2-9a25549e1603' AND status='reserved' AND booking_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.bookings WHERE razorpay_order_id='order_TiuJdAq9NL3xD6');
