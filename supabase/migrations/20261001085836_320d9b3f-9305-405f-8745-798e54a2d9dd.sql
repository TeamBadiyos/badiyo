ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS applicable_category_ids uuid[];

DROP FUNCTION IF EXISTS public.coupon_preview(text, numeric, integer);
DROP FUNCTION IF EXISTS public.system_coupon_reserve(uuid, text, numeric, integer, text);
DROP FUNCTION IF EXISTS public.coupon_quote(uuid, text, numeric, integer);
DROP FUNCTION IF EXISTS public.my_coupons();

CREATE FUNCTION public.coupon_quote(_user_id uuid, _code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c public.coupons%ROWTYPE; _used int; _disc numeric; _grant public.customer_coupons%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _code IS NULL OR btrim(_code) = '' THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_code');
  END IF;
  PERFORM public.coupon_reconcile_user_reservations(_user_id);
  SELECT * INTO c FROM public.coupons WHERE upper(btrim(code)) = upper(btrim(_code)) AND is_active = true LIMIT 1;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_code'); END IF;
  IF c.valid_from > now() OR (c.valid_until IS NOT NULL AND c.valid_until <= now()) THEN
    RETURN jsonb_build_object('ok',false,'reason','expired');
  END IF;
  IF c.applicable_category_ids IS NOT NULL AND cardinality(c.applicable_category_ids) > 0
     AND (_category_id IS NULL OR NOT (_category_id = ANY(c.applicable_category_ids))) THEN
    RETURN jsonb_build_object('ok',false,'reason','not_applicable');
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
    SELECT * INTO _grant FROM public.customer_coupons WHERE coupon_id = c.id AND user_id = _user_id LIMIT 1;
    IF _grant.id IS NULL OR _grant.status <> 'available' OR (_grant.expires_at IS NOT NULL AND _grant.expires_at <= now()) THEN
      RETURN jsonb_build_object('ok',false,'reason','not_eligible');
    END IF;
  END IF;
  IF c.discount_type = 'flat' THEN
    _disc := c.discount_value;
  ELSIF c.discount_type = 'percent' THEN
    _disc := round(COALESCE(_base_amount,0) * c.discount_value / 100.0, 2);
    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;
  ELSE
    IF COALESCE(_duration_minutes,0) <= 0 THEN RETURN jsonb_build_object('ok',false,'reason','not_applicable'); END IF;
    _disc := round(COALESCE(_base_amount,0) * LEAST(c.discount_value, _duration_minutes) / _duration_minutes::numeric, 2);
    IF c.max_discount IS NOT NULL THEN _disc := LEAST(_disc, c.max_discount); END IF;
  END IF;
  _disc := LEAST(GREATEST(COALESCE(_disc,0),0), COALESCE(_base_amount,0));
  IF _disc <= 0 THEN RETURN jsonb_build_object('ok',false,'reason','no_discount'); END IF;
  RETURN jsonb_build_object('ok',true,'coupon_id',c.id,'code',c.code,'title',c.title,'discount',_disc,'discount_type',c.discount_type);
END; $function$;

CREATE FUNCTION public.coupon_preview(_code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.coupon_quote(auth.uid(), _code, _base_amount, _duration_minutes, _category_id);
$$;

CREATE FUNCTION public.system_coupon_reserve(_user_id uuid, _code text, _base_amount numeric, _duration_minutes integer, _order_id text, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE q jsonb;
BEGIN
  q := public.coupon_quote(_user_id, _code, _base_amount, _duration_minutes, _category_id);
  IF (q->>'ok')::boolean IS NOT TRUE THEN RETURN q; END IF;
  INSERT INTO public.coupon_redemptions (coupon_id, user_id, razorpay_order_id, discount_amount, base_amount, status)
  VALUES ((q->>'coupon_id')::uuid, _user_id, _order_id, (q->>'discount')::numeric, COALESCE(_base_amount,0), 'reserved');
  RETURN q;
END; $function$;

CREATE FUNCTION public.my_coupons()
RETURNS TABLE(id uuid, code text, title text, description text, discount_type text, discount_value numeric, max_discount numeric, min_order_amount numeric, valid_until timestamptz, source text, is_personal boolean, applicable_category_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH uid AS (SELECT auth.uid() AS u)
  SELECT c.id, c.code, c.title, c.description, c.discount_type, c.discount_value,
         c.max_discount, c.min_order_amount, LEAST(c.valid_until, cc.expires_at),
         COALESCE(cc.source, 'public'), (cc.id IS NOT NULL), c.applicable_category_ids
    FROM public.coupons c
    LEFT JOIN public.customer_coupons cc ON cc.coupon_id = c.id AND cc.user_id = (SELECT u FROM uid)
   WHERE (SELECT u FROM uid) IS NOT NULL AND c.is_active = true AND c.valid_from <= now()
     AND (c.valid_until IS NULL OR c.valid_until > now())
     AND ((c.audience = 'all') OR (cc.id IS NOT NULL AND cc.status = 'available' AND (cc.expires_at IS NULL OR cc.expires_at > now())))
     AND (c.total_usage_limit IS NULL OR COALESCE(c.used_count,0) < c.total_usage_limit)
     AND (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id AND r.user_id = (SELECT u FROM uid) AND r.status IN ('reserved','applied')) < GREATEST(COALESCE(c.per_user_limit,1),1)
   ORDER BY (cc.id IS NOT NULL) DESC, c.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.staff_set_coupon_categories(_id uuid, _category_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _before jsonb; _row public.coupons%ROWTYPE;
BEGIN
  PERFORM public.offers_require_writer();
  SELECT to_jsonb(c) INTO _before FROM public.coupons c WHERE c.id = _id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Coupon not found'; END IF;
  UPDATE public.coupons SET applicable_category_ids = NULLIF(_category_ids, '{}'::uuid[]), updated_at = now()
   WHERE id = _id RETURNING * INTO _row;
  PERFORM public.offers_audit('coupon_categories_updated', 'coupons', _id, _before, to_jsonb(_row));
END; $function$;

REVOKE ALL ON FUNCTION public.coupon_quote(uuid, text, numeric, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_coupon_reserve(uuid, text, numeric, integer, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coupon_preview(text, numeric, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_coupons() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_set_coupon_categories(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coupon_quote(uuid, text, numeric, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_coupon_reserve(uuid, text, numeric, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.coupon_preview(text, numeric, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_coupons() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_set_coupon_categories(uuid, uuid[]) TO authenticated, service_role;