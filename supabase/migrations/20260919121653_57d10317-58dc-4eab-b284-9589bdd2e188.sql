REVOKE ALL ON FUNCTION public.bookings_apply_coupon() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_after_insert_coupon() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.credit_referral_for_booking(_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _booking_user uuid; _booking_status text;
  _txn_id uuid; _referrer_id uuid; _txn_created timestamptz;
  _is_active boolean; _reward numeric;
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

  SELECT id, referrer_id, created_at INTO _txn_id, _referrer_id, _txn_created
    FROM public.referral_transactions
   WHERE referred_user_id = _booking_user AND status = 'pending'
   ORDER BY created_at LIMIT 1
   FOR UPDATE;
  IF _txn_id IS NULL OR _referrer_id IS NULL THEN RETURN; END IF;

  SELECT is_active, reward_coins, milestone_referrals, milestone_reward_coins
    INTO _is_active, _reward, _milestone_n, _milestone_reward
    FROM public.referral_config ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF _is_active IS NOT TRUE THEN RETURN; END IF;
  _reward := COALESCE(_reward, 0);

  UPDATE public.referral_transactions
    SET status='reward_credited', reward_amount=_reward, reward_date=now(), booking_id=_booking_id
    WHERE id = _txn_id AND status = 'pending';
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users
    SET total_coins_earned = COALESCE(total_coins_earned,0) + _reward::int,
        successful_referrals = COALESCE(successful_referrals,0) + 1
    WHERE id = _referrer_id
    RETURNING successful_referrals INTO _new_count;
  PERFORM set_config('app.users_bypass', 'off', true);

  IF _reward > 0 THEN
    INSERT INTO public.wallet_transactions (user_id, amount, type, description)
      VALUES (_referrer_id, _reward, 'credit', 'Referral Reward');
    PERFORM public.notify_push_event('customer', _referrer_id, 'referral_reward',
      'Referral reward credited',
      'Your friend completed their first booking. You earned ' || _reward::text || ' coins.',
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

  -- Coupon-based milestone rewards (e.g. "refer 3 friends, 1 free hour")
  PERFORM public.award_referral_milestones(_referrer_id);

  PERFORM public.evaluate_reward_triggers('customer', _referrer_id, 'referral_first_booking', _txn_id::text,
    jsonb_build_object('booking_id', _booking_id, 'referred_user_id', _booking_user));
END;
$function$;