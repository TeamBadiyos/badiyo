ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS show_in_list boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "Customers can read coupons granted to them" ON public.coupons;
DROP POLICY IF EXISTS "Signed-in users read active public coupons" ON public.coupons;
CREATE POLICY "Customers read listed eligible coupons" ON public.coupons FOR SELECT TO authenticated
USING (is_active AND show_in_list AND (audience = 'all' OR EXISTS (
  SELECT 1 FROM public.customer_coupons cc WHERE cc.coupon_id = coupons.id AND cc.user_id = auth.uid())));

-- Pending phone grants
CREATE TABLE public.coupon_phone_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  phone10 text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  converted_user_id uuid,
  UNIQUE (coupon_id, phone10)
);
CREATE INDEX coupon_phone_grants_phone_idx ON public.coupon_phone_grants(phone10) WHERE converted_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON public.coupon_phone_grants TO authenticated;
GRANT ALL ON public.coupon_phone_grants TO service_role;
ALTER TABLE public.coupon_phone_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read phone grants" ON public.coupon_phone_grants FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL::text[]));
CREATE POLICY "Staff write phone grants" ON public.coupon_phone_grants FOR INSERT TO authenticated
  WITH CHECK (public.offers_caller_role(auth.uid()) IS NOT NULL);
CREATE POLICY "Staff update phone grants" ON public.coupon_phone_grants FOR UPDATE TO authenticated
  USING (public.offers_caller_role(auth.uid()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.coupon_phone_grants_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.phone10 := right(regexp_replace(coalesce(NEW.phone10,''), '\D', '', 'g'), 10);
  IF length(NEW.phone10) <> 10 THEN RAISE EXCEPTION 'Phone must have 10 digits'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coupon_phone_grants_normalize_trg BEFORE INSERT OR UPDATE OF phone10 ON public.coupon_phone_grants
  FOR EACH ROW EXECUTE FUNCTION public.coupon_phone_grants_normalize();

CREATE OR REPLACE FUNCTION public.coupon_convert_phone_grants(_user_id uuid, _phone text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p text; _n int := 0; g record;
BEGIN
  _p := right(regexp_replace(coalesce(_phone,''), '\D', '', 'g'), 10);
  IF _user_id IS NULL OR length(_p) <> 10 THEN RETURN 0; END IF;
  FOR g IN SELECT * FROM public.coupon_phone_grants WHERE phone10 = _p AND converted_at IS NULL FOR UPDATE LOOP
    INSERT INTO public.customer_coupons (user_id, coupon_id, source, source_ref)
    VALUES (_user_id, g.coupon_id, 'phone_grant', g.id::text)
    ON CONFLICT (user_id, coupon_id) DO NOTHING;
    UPDATE public.coupon_phone_grants SET converted_at = now(), converted_user_id = _user_id WHERE id = g.id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.coupon_convert_phone_grants(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_convert_phone_grants(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.my_coupon_claim_phone_grants()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ph text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  SELECT phone INTO _ph FROM public.users WHERE id = auth.uid();
  RETURN public.coupon_convert_phone_grants(auth.uid(), _ph);
END $$;
REVOKE ALL ON FUNCTION public.my_coupon_claim_phone_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coupon_claim_phone_grants() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.users_register_phone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _p text;
BEGIN
  _p := public.referral_phone10(NEW.phone);
  IF _p IS NOT NULL THEN
    INSERT INTO public.referral_phone_registry (phone, first_user_id, last_user_id)
    VALUES (_p, NEW.id, NEW.id)
    ON CONFLICT (phone) DO UPDATE SET last_user_id = EXCLUDED.last_user_id;
    BEGIN
      PERFORM public.coupon_convert_phone_grants(NEW.id, NEW.phone);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

-- Attempt log
CREATE TABLE public.coupon_attempt_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_attempted text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coupon_attempt_logs_user_idx ON public.coupon_attempt_logs(user_id, created_at DESC);
GRANT ALL ON public.coupon_attempt_logs TO service_role;
GRANT SELECT ON public.coupon_attempt_logs TO authenticated;
ALTER TABLE public.coupon_attempt_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read coupon attempts" ON public.coupon_attempt_logs FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid(), NULL::text[]));

-- Core quote (unchanged rules) renamed; wrapper adds attempt limiting for user-typed checks
ALTER FUNCTION public.coupon_quote(uuid, text, numeric, integer, uuid) RENAME TO coupon_quote_core;
REVOKE ALL ON FUNCTION public.coupon_quote_core(uuid, text, numeric, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_quote_core(uuid, text, numeric, integer, uuid) TO service_role;

CREATE FUNCTION public.coupon_quote(_user_id uuid, _code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q jsonb; _fails int; _r text;
BEGIN
  IF _user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_code'); END IF;
  SELECT count(*) INTO _fails FROM public.coupon_attempt_logs
   WHERE user_id = _user_id AND created_at > now() - interval '10 minutes';
  IF _fails >= 5 THEN RETURN jsonb_build_object('ok',false,'reason','too_many_attempts'); END IF;
  q := public.coupon_quote_core(_user_id, _code, _base_amount, _duration_minutes, _category_id);
  _r := q->>'reason';
  IF (q->>'ok')::boolean IS NOT TRUE AND _r IN ('invalid_code','not_eligible','expired','exhausted') THEN
    INSERT INTO public.coupon_attempt_logs (user_id, code_attempted, reason)
    VALUES (_user_id, left(upper(btrim(coalesce(_code,''))), 40), _r);
  END IF;
  RETURN q;
END $$;
REVOKE ALL ON FUNCTION public.coupon_quote(uuid, text, numeric, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_quote(uuid, text, numeric, integer, uuid) TO service_role;

-- List evaluation must not burn attempts: listed coupons use the core directly
CREATE OR REPLACE FUNCTION public.coupon_preview_listed(_code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL, _category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.my_coupons() m WHERE upper(m.code) = upper(btrim(_code))) THEN
    RETURN public.coupon_quote(auth.uid(), _code, _base_amount, _duration_minutes, _category_id);
  END IF;
  RETURN public.coupon_quote_core(auth.uid(), _code, _base_amount, _duration_minutes, _category_id);
END $$;
REVOKE ALL ON FUNCTION public.coupon_preview_listed(text, numeric, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coupon_preview_listed(text, numeric, integer, uuid) TO authenticated, service_role;

-- my_coupons: only listed, add is_targeted
DROP FUNCTION IF EXISTS public.my_coupons();
CREATE FUNCTION public.my_coupons()
RETURNS TABLE(id uuid, code text, title text, description text, discount_type text, discount_value numeric, max_discount numeric, min_order_amount numeric, valid_until timestamptz, source text, is_personal boolean, applicable_category_ids uuid[], is_targeted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH uid AS (SELECT auth.uid() AS u)
  SELECT c.id, c.code, c.title, c.description, c.discount_type, c.discount_value,
         c.max_discount, c.min_order_amount, LEAST(c.valid_until, cc.expires_at),
         COALESCE(cc.source, 'public'), (cc.id IS NOT NULL), c.applicable_category_ids,
         (c.audience <> 'all')
    FROM public.coupons c
    LEFT JOIN public.customer_coupons cc ON cc.coupon_id = c.id AND cc.user_id = (SELECT u FROM uid)
   WHERE (SELECT u FROM uid) IS NOT NULL AND c.is_active = true AND c.show_in_list = true
     AND c.valid_from <= now() AND (c.valid_until IS NULL OR c.valid_until > now())
     AND ((c.audience = 'all') OR (cc.id IS NOT NULL AND cc.status = 'available' AND (cc.expires_at IS NULL OR cc.expires_at > now())))
     AND (c.total_usage_limit IS NULL OR COALESCE(c.used_count,0) < c.total_usage_limit)
     AND (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = c.id AND r.user_id = (SELECT u FROM uid) AND r.status IN ('reserved','applied')) < GREATEST(COALESCE(c.per_user_limit,1),1)
   ORDER BY (c.audience <> 'all') DESC, c.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.my_coupons() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coupons() TO authenticated, service_role;