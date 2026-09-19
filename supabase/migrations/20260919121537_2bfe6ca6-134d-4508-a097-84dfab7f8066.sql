-- Tighten anon exposure: offers are for signed-in customers only
REVOKE SELECT ON public.coupons FROM anon;
REVOKE SELECT ON public.referral_milestone_programs FROM anon;
REVOKE SELECT ON public.marketing_campaigns FROM anon;

DROP POLICY "Anyone can read active public coupons" ON public.coupons;
CREATE POLICY "Signed-in users read active public coupons"
  ON public.coupons FOR SELECT TO authenticated
  USING (is_active = true AND audience = 'all');

DROP POLICY "Anyone can read active milestone programs" ON public.referral_milestone_programs;
CREATE POLICY "Signed-in users read active milestone programs"
  ON public.referral_milestone_programs FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY "Anyone can read live campaigns" ON public.marketing_campaigns;
CREATE POLICY "Signed-in users read live campaigns"
  ON public.marketing_campaigns FOR SELECT TO authenticated
  USING (
    show_in_offers = true
    AND status IN ('scheduled','sent')
    AND starts_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
  );

-- =========================================================
-- QUOTE
-- =========================================================
CREATE OR REPLACE FUNCTION public.coupon_quote(
  _user_id uuid, _code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.coupons%ROWTYPE; _grant public.customer_coupons%ROWTYPE; _used int; _disc numeric;
BEGIN
  IF _user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_authenticated'); END IF;
  IF _code IS NULL OR btrim(_code) = '' THEN RETURN jsonb_build_object('ok',false,'reason','invalid_code'); END IF;

  SELECT * INTO c FROM public.coupons WHERE upper(code) = upper(btrim(_code)) LIMIT 1;
  IF c.id IS NULL OR c.is_active IS NOT TRUE THEN
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
  ELSE -- free_minutes
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

CREATE OR REPLACE FUNCTION public.coupon_preview(
  _code text, _base_amount numeric, _duration_minutes integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.coupon_quote(auth.uid(), _code, _base_amount, _duration_minutes);
$$;
REVOKE ALL ON FUNCTION public.coupon_preview(text,numeric,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coupon_preview(text,numeric,integer) TO authenticated, service_role;

-- =========================================================
-- RESERVE / RELEASE (server only)
-- =========================================================
CREATE OR REPLACE FUNCTION public.system_coupon_reserve(
  _user_id uuid, _code text, _base_amount numeric, _duration_minutes integer, _order_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q jsonb;
BEGIN
  q := public.coupon_quote(_user_id, _code, _base_amount, _duration_minutes);
  IF (q->>'ok')::boolean IS NOT TRUE THEN RETURN q; END IF;

  INSERT INTO public.coupon_redemptions (coupon_id, user_id, razorpay_order_id, discount_amount, base_amount, status)
  VALUES ((q->>'coupon_id')::uuid, _user_id, _order_id, (q->>'discount')::numeric, COALESCE(_base_amount,0), 'reserved');

  RETURN q;
END; $$;
REVOKE ALL ON FUNCTION public.system_coupon_reserve(uuid,text,numeric,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_coupon_reserve(uuid,text,numeric,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.system_coupon_release(_order_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.coupon_redemptions SET status = 'released'
   WHERE razorpay_order_id = _order_id AND status = 'reserved';
$$;
REVOKE ALL ON FUNCTION public.system_coupon_release(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_coupon_release(text) TO service_role;

-- Release reservations that never became a booking (older than 2h)
CREATE OR REPLACE FUNCTION public.release_stale_coupon_reservations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE public.coupon_redemptions SET status = 'released'
   WHERE status = 'reserved' AND created_at < now() - interval '2 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.release_stale_coupon_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_stale_coupon_reservations() TO service_role;

-- =========================================================
-- APPLY TO BOOKING
-- =========================================================
CREATE OR REPLACE FUNCTION public.bookings_apply_coupon()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.coupon_redemptions%ROWTYPE; _code text; _disc numeric;
BEGIN
  NEW.coupon_id := NULL; NEW.coupon_code := NULL; NEW.discount_amount := 0;
  IF NEW.razorpay_order_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO r FROM public.coupon_redemptions
   WHERE razorpay_order_id = NEW.razorpay_order_id AND user_id = NEW.user_id
     AND status = 'reserved' ORDER BY created_at LIMIT 1;
  IF r.id IS NULL THEN RETURN NEW; END IF;

  SELECT code INTO _code FROM public.coupons WHERE id = r.coupon_id;
  _disc := LEAST(GREATEST(COALESCE(r.discount_amount,0),0), COALESCE(NEW.total_amount,0));
  NEW.coupon_id := r.coupon_id;
  NEW.coupon_code := _code;
  NEW.discount_amount := _disc;
  NEW.total_amount := COALESCE(NEW.total_amount,0) - _disc;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_z_bookings_apply_coupon BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_apply_coupon();

CREATE OR REPLACE FUNCTION public.bookings_after_insert_coupon()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.coupon_id IS NULL THEN RETURN NEW; END IF;

  UPDATE public.coupon_redemptions
     SET status = 'applied', booking_id = NEW.id
   WHERE razorpay_order_id = NEW.razorpay_order_id AND user_id = NEW.user_id AND status = 'reserved';

  UPDATE public.coupons SET used_count = COALESCE(used_count,0) + 1 WHERE id = NEW.coupon_id;

  UPDATE public.customer_coupons SET status = 'used', used_at = now()
   WHERE coupon_id = NEW.coupon_id AND user_id = NEW.user_id AND status = 'available';

  PERFORM public.notify_push_event('customer', NEW.user_id, 'coupon_used',
    'Coupon applied',
    'You saved ' || round(NEW.discount_amount)::text || ' on this booking with ' || COALESCE(NEW.coupon_code,'your coupon') || '.',
    jsonb_build_object('route','offers','booking_id', NEW.id));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_bookings_after_insert_coupon AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_after_insert_coupon();

-- =========================================================
-- CUSTOMER-FACING LISTS
-- =========================================================
CREATE OR REPLACE FUNCTION public.my_coupons()
RETURNS TABLE(
  id uuid, code text, title text, description text, discount_type text,
  discount_value numeric, max_discount numeric, min_order_amount numeric,
  valid_until timestamptz, source text, is_personal boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH uid AS (SELECT auth.uid() AS u)
  SELECT c.id, c.code, c.title, c.description, c.discount_type, c.discount_value,
         c.max_discount, c.min_order_amount,
         LEAST(c.valid_until, cc.expires_at) AS valid_until,
         COALESCE(cc.source, 'public') AS source,
         (cc.id IS NOT NULL) AS is_personal
    FROM public.coupons c
    LEFT JOIN public.customer_coupons cc
      ON cc.coupon_id = c.id AND cc.user_id = (SELECT u FROM uid)
   WHERE (SELECT u FROM uid) IS NOT NULL
     AND c.is_active = true
     AND c.valid_from <= now()
     AND (c.valid_until IS NULL OR c.valid_until > now())
     AND (
       (c.audience = 'all')
       OR (cc.id IS NOT NULL AND cc.status = 'available'
           AND (cc.expires_at IS NULL OR cc.expires_at > now()))
     )
     AND (c.total_usage_limit IS NULL OR COALESCE(c.used_count,0) < c.total_usage_limit)
     AND (
       SELECT count(*) FROM public.coupon_redemptions r
        WHERE r.coupon_id = c.id AND r.user_id = (SELECT u FROM uid)
          AND r.status IN ('reserved','applied')
     ) < GREATEST(COALESCE(c.per_user_limit,1),1)
   ORDER BY (cc.id IS NOT NULL) DESC, c.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.my_coupons() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_coupons() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_referral_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _invited int; _joined int; _qualified int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('invited',0,'joined',0,'qualified',0); END IF;
  SELECT count(*) INTO _joined FROM public.referral_transactions WHERE referrer_id = _uid;
  SELECT count(*) INTO _qualified FROM public.referral_transactions
   WHERE referrer_id = _uid AND status IN ('first_booking_completed','reward_credited');
  _invited := _joined;
  RETURN jsonb_build_object('invited',_invited,'joined',_joined,'qualified',_qualified);
END; $$;
REVOKE ALL ON FUNCTION public.my_referral_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_progress() TO authenticated, service_role;

-- =========================================================
-- REFERRAL MILESTONE COUPONS
-- =========================================================
CREATE OR REPLACE FUNCTION public.award_referral_milestones(_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; _qualified int; _coupon_id uuid; _code text; _n int := 0;
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;
  SELECT count(*) INTO _qualified FROM public.referral_transactions
   WHERE referrer_id = _user_id AND status IN ('first_booking_completed','reward_credited');

  FOR p IN
    SELECT * FROM public.referral_milestone_programs
     WHERE is_active = true AND required_referrals <= _qualified
  LOOP
    IF EXISTS (SELECT 1 FROM public.referral_milestone_awards
                WHERE user_id = _user_id AND program_id = p.id) THEN
      CONTINUE;
    END IF;

    _code := 'REF' || upper(substring(replace(gen_random_uuid()::text,'-',''),1,7));
    INSERT INTO public.coupons (code, title, description, discount_type, discount_value,
                                max_discount, min_order_amount, valid_until,
                                total_usage_limit, per_user_limit, audience)
    VALUES (_code, p.name, p.description, p.reward_discount_type, p.reward_discount_value,
            p.reward_max_discount, p.reward_min_order_amount,
            now() + make_interval(days => GREATEST(COALESCE(p.reward_validity_days,30),1)),
            1, 1, 'referral_reward')
    RETURNING id INTO _coupon_id;

    INSERT INTO public.customer_coupons (user_id, coupon_id, source, source_ref, expires_at)
    VALUES (_user_id, _coupon_id, 'referral_milestone', p.id::text,
            now() + make_interval(days => GREATEST(COALESCE(p.reward_validity_days,30),1)));

    INSERT INTO public.referral_milestone_awards (user_id, program_id, coupon_id, referrals_at_award)
    VALUES (_user_id, p.id, _coupon_id, _qualified);

    PERFORM public.notify_push_event('customer', _user_id, 'coupon_issued',
      'You unlocked a reward!',
      p.name || ' — use code ' || _code || ' on your next booking.',
      jsonb_build_object('route','offers','coupon_code',_code));

    _n := _n + 1;
  END LOOP;
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.award_referral_milestones(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_milestones(uuid) TO service_role;

-- =========================================================
-- MARKETING CAMPAIGN SEND
-- =========================================================
CREATE OR REPLACE FUNCTION public.system_send_marketing_campaign(_campaign_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.marketing_campaigns%ROWTYPE; u record; _n int := 0;
BEGIN
  SELECT * INTO c FROM public.marketing_campaigns WHERE id = _campaign_id;
  IF c.id IS NULL OR c.status = 'sent' OR c.status = 'cancelled' THEN RETURN 0; END IF;

  FOR u IN
    SELECT id FROM public.users
     WHERE COALESCE((notification_preferences->>'promos')::boolean, true) = true
  LOOP
    BEGIN
      INSERT INTO public.campaign_deliveries (campaign_id, user_id) VALUES (c.id, u.id);
    EXCEPTION WHEN unique_violation THEN CONTINUE;
    END;

    PERFORM public.notify_push_event('customer', u.id, 'marketing', c.title, c.body,
      jsonb_build_object('route', COALESCE(c.deep_link,'offers'), 'campaign_id', c.id));
    _n := _n + 1;
  END LOOP;

  UPDATE public.marketing_campaigns
     SET status = 'sent', sent_at = now(), recipients_count = _n
   WHERE id = c.id;
  RETURN _n;
END; $$;
REVOKE ALL ON FUNCTION public.system_send_marketing_campaign(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_send_marketing_campaign(uuid) TO service_role;