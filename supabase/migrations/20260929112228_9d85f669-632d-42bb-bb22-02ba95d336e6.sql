-- 1. Config columns
ALTER TABLE public.referral_config
  ADD COLUMN IF NOT EXISTS signup_reward_coins numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS booking_reward_coins numeric NOT NULL DEFAULT 20;

ALTER TABLE public.referral_config ALTER COLUMN reward_coins SET DEFAULT 30;

UPDATE public.referral_config
   SET signup_reward_coins = 10,
       booking_reward_coins = 20,
       reward_coins = 30,
       updated_at = now();

-- 2. Transaction stage columns
ALTER TABLE public.referral_transactions
  ADD COLUMN IF NOT EXISTS signup_reward_amount numeric,
  ADD COLUMN IF NOT EXISTS signup_reward_date timestamptz,
  ADD COLUMN IF NOT EXISTS booking_reward_amount numeric,
  ADD COLUMN IF NOT EXISTS booking_reward_date timestamptz;

-- 3. Helper: pay the signup-stage reward (idempotent)
CREATE OR REPLACE FUNCTION public.credit_referral_signup(_txn_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _referrer_id uuid; _referred uuid; _status text; _already timestamptz;
  _is_active boolean; _signup numeric;
BEGIN
  SELECT referrer_id, referred_user_id, status, signup_reward_date
    INTO _referrer_id, _referred, _status, _already
    FROM public.referral_transactions WHERE id = _txn_id FOR UPDATE;
  IF _referrer_id IS NULL THEN RETURN 0; END IF;
  IF _already IS NOT NULL THEN RETURN 0; END IF;
  IF _status = 'reversed' THEN RETURN 0; END IF;

  SELECT is_active, COALESCE(signup_reward_coins,0)
    INTO _is_active, _signup
    FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _is_active IS NOT TRUE THEN RETURN 0; END IF;
  _signup := COALESCE(_signup, 0);

  UPDATE public.referral_transactions
     SET signup_reward_amount = _signup,
         signup_reward_date = now(),
         status = CASE WHEN status = 'pending' THEN 'registered' ELSE status END
   WHERE id = _txn_id AND signup_reward_date IS NULL;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF _signup > 0 THEN
    PERFORM set_config('app.users_bypass', 'on', true);
    UPDATE public.users
       SET total_coins_earned = COALESCE(total_coins_earned,0) + _signup::int
     WHERE id = _referrer_id;
    PERFORM set_config('app.users_bypass', 'off', true);

    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
      VALUES (_referrer_id, _signup, 'credit', 'Referral signup bonus');

    PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
      'Referral bonus credited',
      'Your friend joined badiyos. You earned ' || _signup::text ||
      ' coins. Get more when they complete their first booking.',
      jsonb_build_object('route','refer-earn'));
  END IF;

  RETURN _signup;
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_referral_signup(uuid) TO authenticated, service_role;

-- 4. apply_referral_code pays the signup stage immediately
CREATE OR REPLACE FUNCTION public.apply_referral_code(_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _referrer_id uuid;
  _current_ref text;
  _txn_id uuid;
BEGIN
  IF _uid IS NULL THEN RETURN 'not_authenticated'; END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN RETURN 'invalid_code'; END IF;

  SELECT referred_by INTO _current_ref FROM public.users WHERE id = _uid;
  IF _current_ref IS NOT NULL AND length(_current_ref) > 0 THEN RETURN 'already_referred'; END IF;

  SELECT id INTO _referrer_id FROM public.users
   WHERE upper(referral_code) = upper(trim(_code)) LIMIT 1;
  IF _referrer_id IS NULL THEN RETURN 'invalid_code'; END IF;
  IF _referrer_id = _uid THEN RETURN 'self_referral'; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users SET referred_by = upper(trim(_code)) WHERE id = _uid;
  PERFORM set_config('app.users_bypass', 'off', true);

  SELECT id INTO _txn_id FROM public.referral_transactions WHERE referred_user_id = _uid LIMIT 1;
  IF _txn_id IS NULL THEN
    INSERT INTO public.referral_transactions (referrer_id, referred_user_id, status)
    VALUES (_referrer_id, _uid, 'pending')
    RETURNING id INTO _txn_id;
  END IF;

  PERFORM public.credit_referral_signup(_txn_id);

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_signup', _uid::text,
    jsonb_build_object('referred_user_id', _uid));

  RETURN 'applied';
END;
$$;

-- 5. Booking-stage reward
CREATE OR REPLACE FUNCTION public.credit_referral_for_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _booking_user uuid; _booking_status text;
  _txn_id uuid; _referrer_id uuid;
  _is_active boolean; _booking_reward numeric; _signup_paid numeric;
  _milestone_n integer; _milestone_reward numeric; _new_count integer;
BEGIN
  SELECT user_id, status INTO _booking_user, _booking_status
    FROM public.bookings WHERE id = _booking_id;
  IF _booking_user IS NULL THEN RETURN; END IF;
  IF _booking_status <> 'completed' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.referral_transactions
              WHERE referred_user_id = _booking_user AND status = 'reward_credited') THEN
    RETURN;
  END IF;

  SELECT id, referrer_id INTO _txn_id, _referrer_id
    FROM public.referral_transactions
   WHERE referred_user_id = _booking_user AND status IN ('pending','registered')
   ORDER BY created_at LIMIT 1
   FOR UPDATE;
  IF _txn_id IS NULL OR _referrer_id IS NULL THEN RETURN; END IF;

  -- Pay the signup stage first if it was never paid
  _signup_paid := public.credit_referral_signup(_txn_id);

  SELECT is_active, COALESCE(booking_reward_coins,0), milestone_referrals, milestone_reward_coins
    INTO _is_active, _booking_reward, _milestone_n, _milestone_reward
    FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _is_active IS NOT TRUE THEN RETURN; END IF;
  _booking_reward := COALESCE(_booking_reward, 0);

  UPDATE public.referral_transactions
    SET status = 'reward_credited',
        booking_reward_amount = _booking_reward,
        booking_reward_date = now(),
        reward_amount = COALESCE(signup_reward_amount,0) + _booking_reward,
        reward_date = now(),
        booking_id = _booking_id
    WHERE id = _txn_id AND status IN ('pending','registered');
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users
    SET total_coins_earned = COALESCE(total_coins_earned,0) + _booking_reward::int,
        successful_referrals = COALESCE(successful_referrals,0) + 1
    WHERE id = _referrer_id
    RETURNING successful_referrals INTO _new_count;
  PERFORM set_config('app.users_bypass', 'off', true);

  IF _booking_reward > 0 THEN
    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
      VALUES (_referrer_id, _booking_reward, 'credit', 'Referral first booking bonus');
    PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
      'Referral reward credited',
      'Your friend completed their first booking. You earned ' || _booking_reward::text || ' coins.',
      jsonb_build_object('route','refer-earn'));
  END IF;

  IF COALESCE(_milestone_n,0) > 0 AND COALESCE(_milestone_reward,0) > 0
     AND COALESCE(_new_count,0) > 0 AND _new_count % _milestone_n = 0 THEN
    PERFORM set_config('app.users_bypass', 'on', true);
    UPDATE public.users
       SET total_coins_earned = COALESCE(total_coins_earned,0) + _milestone_reward::int
     WHERE id = _referrer_id;
    PERFORM set_config('app.users_bypass', 'off', true);
    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
      VALUES (_referrer_id, _milestone_reward, 'credit',
              'Referral milestone bonus (' || _new_count::text || ' referrals)');
    PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
      'Referral milestone reached',
      'You have ' || _new_count::text || ' successful referrals. Bonus of '
        || _milestone_reward::text || ' coins credited.',
      jsonb_build_object('route','refer-earn'));
  END IF;

  PERFORM public.award_referral_milestones(_referrer_id);

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_first_booking', _txn_id::text,
    jsonb_build_object('booking_id', _booking_id, 'referred_user_id', _booking_user));
END;
$$;

-- 6. Reversal takes back both stages
CREATE OR REPLACE FUNCTION public.staff_reverse_referral_reward(_txn_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb; _referrer uuid; _amount numeric; _status text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reason IS NULL OR btrim(_reason)='' THEN RAISE EXCEPTION 'Reason required'; END IF;

  SELECT to_jsonb(r), referrer_id,
         GREATEST(COALESCE(reward_amount,0),
                  COALESCE(signup_reward_amount,0) + COALESCE(booking_reward_amount,0)),
         status
    INTO _before, _referrer, _amount, _status
    FROM public.referral_transactions r WHERE id=_txn_id;
  IF _before IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF _status <> 'reward_credited' THEN RAISE EXCEPTION 'Only credited rewards can be reversed'; END IF;

  UPDATE public.referral_transactions
     SET status='reversed', reversal_reason=btrim(_reason), reversed_at=now()
   WHERE id=_txn_id;

  PERFORM set_config('app.users_bypass','on', true);
  UPDATE public.users
     SET total_coins_earned = GREATEST(COALESCE(total_coins_earned,0) - _amount::int, 0),
         successful_referrals = GREATEST(COALESCE(successful_referrals,0) - 1, 0)
   WHERE id = _referrer;
  PERFORM set_config('app.users_bypass','off', true);

  INSERT INTO public.wallet_transactions(user_id, amount, type, description)
    VALUES(_referrer, _amount, 'debit', 'Referral reward reversed: '||btrim(_reason));

  SELECT to_jsonb(r) INTO _after FROM public.referral_transactions r WHERE id=_txn_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'reverse_referral_reward','referral_transactions',_txn_id,_before,_after);
END;
$$;

-- 7. Command Center settings: legacy total-only entry point stays valid
CREATE OR REPLACE FUNCTION public.staff_update_referral_config(_reward numeric, _is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb; _id uuid; _signup numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _reward IS NULL OR _reward < 0 THEN RAISE EXCEPTION 'Reward must be non-negative'; END IF;

  SELECT id, COALESCE(signup_reward_coins,0) INTO _id, _signup
    FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO public.referral_config(reward_coins, signup_reward_coins, booking_reward_coins, is_active, updated_at)
      VALUES(_reward, LEAST(10, _reward), GREATEST(_reward - LEAST(10, _reward), 0), _is_active, now())
      RETURNING id INTO _id;
    _before := NULL;
  ELSE
    SELECT to_jsonb(c) INTO _before FROM public.referral_config c WHERE id=_id;
    _signup := LEAST(COALESCE(_signup,0), _reward);
    UPDATE public.referral_config
       SET reward_coins=_reward,
           signup_reward_coins=_signup,
           booking_reward_coins=GREATEST(_reward - _signup, 0),
           is_active=_is_active,
           updated_at=now()
     WHERE id=_id;
  END IF;
  SELECT to_jsonb(c) INTO _after FROM public.referral_config c WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'update_referral_config','referral_config',_id,_before,_after);
END;
$$;

-- 8. New Command Center settings entry point for the two-stage split
CREATE OR REPLACE FUNCTION public.staff_update_referral_rewards(
  _signup_reward numeric,
  _booking_reward numeric,
  _is_active boolean DEFAULT true,
  _milestone_referrals integer DEFAULT NULL,
  _milestone_reward_coins numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _before jsonb; _after jsonb; _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _signup_reward IS NULL OR _signup_reward < 0 THEN RAISE EXCEPTION 'Signup reward must be non-negative'; END IF;
  IF _booking_reward IS NULL OR _booking_reward < 0 THEN RAISE EXCEPTION 'Booking reward must be non-negative'; END IF;
  IF _milestone_referrals IS NOT NULL AND _milestone_referrals < 0 THEN RAISE EXCEPTION 'Milestone referrals must be non-negative'; END IF;
  IF _milestone_reward_coins IS NOT NULL AND _milestone_reward_coins < 0 THEN RAISE EXCEPTION 'Milestone reward must be non-negative'; END IF;

  SELECT id INTO _id FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO public.referral_config(
      reward_coins, signup_reward_coins, booking_reward_coins, is_active,
      milestone_referrals, milestone_reward_coins, updated_at)
    VALUES(_signup_reward + _booking_reward, _signup_reward, _booking_reward, COALESCE(_is_active,true),
      COALESCE(_milestone_referrals,5), COALESCE(_milestone_reward_coins,100), now())
    RETURNING id INTO _id;
    _before := NULL;
  ELSE
    SELECT to_jsonb(c) INTO _before FROM public.referral_config c WHERE id=_id;
    UPDATE public.referral_config
       SET signup_reward_coins = _signup_reward,
           booking_reward_coins = _booking_reward,
           reward_coins = _signup_reward + _booking_reward,
           is_active = COALESCE(_is_active, is_active),
           milestone_referrals = COALESCE(_milestone_referrals, milestone_referrals),
           milestone_reward_coins = COALESCE(_milestone_reward_coins, milestone_reward_coins),
           updated_at = now()
     WHERE id = _id;
  END IF;

  SELECT to_jsonb(c) INTO _after FROM public.referral_config c WHERE id=_id;
  INSERT INTO public.audit_logs(actor_id, action, target_table, target_id, before_state, after_state)
    VALUES(_uid,'update_referral_rewards','referral_config',_id,_before,_after);
  RETURN _after;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_update_referral_rewards(numeric, numeric, boolean, integer, numeric) TO authenticated, service_role;

-- 9. Read-back helper for Command Center
CREATE OR REPLACE FUNCTION public.staff_get_referral_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _row jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_active_staff(_uid, ARRAY['super_admin','ops','support']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT to_jsonb(c) INTO _row FROM public.referral_config c ORDER BY c.updated_at DESC NULLS LAST LIMIT 1;
  RETURN COALESCE(_row, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_get_referral_config() TO authenticated, service_role;
