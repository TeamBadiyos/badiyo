-- 1. Release the stuck reservation from the interrupted order
UPDATE public.coupon_redemptions
   SET status = 'released', updated_at = now()
 WHERE razorpay_order_id = 'free_98d47f01-3a0b-4354-aae5-90df84ff2348'
   AND status = 'reserved';

-- 2. Shared self-heal: reconcile one user's dangling reservations (event-driven, no polling)
CREATE OR REPLACE FUNCTION public.coupon_reconcile_user_reservations(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user_id IS NULL THEN RETURN; END IF;

  -- Reservation whose booking actually exists -> mark applied, never freed.
  UPDATE public.coupon_redemptions r
     SET status = 'applied', booking_id = b.id, updated_at = now()
    FROM public.bookings b
   WHERE r.user_id = _user_id
     AND r.status = 'reserved'
     AND b.razorpay_order_id = r.razorpay_order_id
     AND b.user_id = r.user_id;

  -- Orphan reservation with no booking after 10 minutes -> free it.
  UPDATE public.coupon_redemptions
     SET status = 'released', updated_at = now()
   WHERE user_id = _user_id
     AND status = 'reserved'
     AND booking_id IS NULL
     AND created_at < now() - interval '10 minutes';
END; $$;
REVOKE ALL ON FUNCTION public.coupon_reconcile_user_reservations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_reconcile_user_reservations(uuid) TO service_role;

-- 3. Self-heal right before every eligibility check
CREATE OR REPLACE FUNCTION public.coupon_quote(
  _user_id uuid, _code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.coupons%ROWTYPE; _used int; _disc numeric; _grant public.customer_coupons%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _code IS NULL OR btrim(_code) = '' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;

  PERFORM public.coupon_reconcile_user_reservations(_user_id);

  SELECT * INTO c FROM public.coupons
   WHERE upper(btrim(code)) = upper(btrim(_code)) AND is_active = true LIMIT 1;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;
  IF c.valid_from > now() OR (c.valid_until IS NOT NULL AND c.valid_until <= now()) THEN
    RETURN jsonb_build_object('ok',false,'reason','expired');
  END IF;
  IF COALESCE(_base_amount,0) < COALESCE(c.min_order_amount,0) THEN
    RETURN jsonb_build_object('ok',false,'reason','min_order','min_order_amount',c.min_order_amount);
  END IF;
  IF c.total_usage_limit IS NOT NULL AND COALESCE(c.used_count,0) >= c.total_usage_limit THEN
    RETURN jsonb_build_object('ok',false,'reason','exhausted');
  END IF;

  SELECT count(*) INTO _used FROM public.coupon_redemptions
   WHERE coupon_id = c.id AND user_id = _user_id AND status IN ('reserved','applied');
  IF _used >= GREATEST(COALESCE(c.per_user_limit,1),1) THEN
    RETURN jsonb_build_object('ok',false,'reason','already_used');
  END IF;

  IF c.audience <> 'all' THEN
    SELECT * INTO _grant FROM public.customer_coupons
     WHERE coupon_id = c.id AND user_id = _user_id LIMIT 1;
    IF _grant.id IS NULL OR _grant.status <> 'available'
       OR (_grant.expires_at IS NOT NULL AND _grant.expires_at <= now()) THEN
      RETURN jsonb_build_object('ok',false,'reason','not_eligible');
    END IF;
  END IF;

  IF c.discount_type = 'flat' THEN
    _disc := c.discount_value;
  ELSIF c.discount_type = 'percent' THEN
    _disc := round(COALESCE(_base_amount,0) * c.discount_value / 100.0, 2);
    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;
  ELSE
    IF COALESCE(_duration_minutes,0) <= 0 THEN
      RETURN jsonb_build_object('ok',false,'reason','not_applicable');
    END IF;
    _disc := round(COALESCE(_base_amount,0)
             * LEAST(c.discount_value, _duration_minutes) / _duration_minutes::numeric, 2);
    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;
  END IF;

  _disc := LEAST(GREATEST(COALESCE(_disc,0),0), COALESCE(_base_amount,0));
  IF _disc <= 0 THEN RETURN jsonb_build_object('ok',false,'reason','no_discount'); END IF;

  RETURN jsonb_build_object('ok',true,'coupon_id',c.id,'code',c.code,'title',c.title,
                            'discount',_disc,'discount_type',c.discount_type);
END; $$;
REVOKE ALL ON FUNCTION public.coupon_quote(uuid,text,numeric,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_quote(uuid,text,numeric,integer) TO service_role;

-- 4. Client-callable instant release for a failed/cancelled checkout
CREATE OR REPLACE FUNCTION public.release_my_coupon_redemption(_order_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL OR _order_id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.bookings
              WHERE razorpay_order_id = _order_id AND user_id = auth.uid()) THEN
    RETURN 0;
  END IF;
  UPDATE public.coupon_redemptions
     SET status = 'released', updated_at = now()
   WHERE razorpay_order_id = _order_id
     AND user_id = auth.uid()
     AND status = 'reserved'
     AND booking_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.release_my_coupon_redemption(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_my_coupon_redemption(text) TO authenticated, service_role;