CREATE OR REPLACE FUNCTION public.app_checkout_coupons(_base_amount numeric, _duration_minutes integer DEFAULT NULL, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING errcode='42501'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'ok')::boolean DESC, (x->>'discount')::numeric DESC NULLS LAST, x->>'code'), '[]') INTO out
  FROM (
    SELECT jsonb_build_object('code', c.code, 'title', c.title, 'description', c.description,
      'min_order_amount', nullif(c.min_order_amount,0), 'ok', coalesce((q->>'ok')::boolean,false),
      'discount', CASE WHEN (q->>'ok')::boolean THEN (q->>'discount')::numeric END,
      'reason', q->>'reason') x
    FROM coupons c
    LEFT JOIN customer_coupons cc ON cc.coupon_id=c.id AND cc.user_id=_uid
    CROSS JOIN LATERAL (SELECT coupon_quote_core(_uid, c.code, _base_amount, _duration_minutes, _category_id) q) z
    WHERE c.is_active AND c.show_in_list AND c.valid_from <= now() AND (c.valid_until IS NULL OR c.valid_until > now())
      AND (c.audience IN ('all','new_customers','existing_customers') OR cc.id IS NOT NULL)
    LIMIT 50) t;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.app_checkout_coupons(numeric,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_checkout_coupons(numeric,integer,uuid) TO authenticated;