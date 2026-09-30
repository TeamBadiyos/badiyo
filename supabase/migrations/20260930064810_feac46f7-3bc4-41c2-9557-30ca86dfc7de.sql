CREATE TABLE IF NOT EXISTS public._referral_test_log (k text, v text);
GRANT ALL ON public._referral_test_log TO service_role;

DO $$
DECLARE
  v_txn uuid := '9944a2a4-d155-48a8-9923-b0f8dd1f52bb';
  v_ref uuid := '000a6daa-3e02-487f-904c-5d7689c61baa';
  v_user uuid := 'ae1dad53-015d-4697-9c6b-861ba1fe422d';
  v_txn_before public.referral_transactions%ROWTYPE;
  v_coins_before int; v_succ_before int;
  v_booking uuid;
  v_wt_before int; v_wt_after int;
BEGIN
  SELECT * INTO v_txn_before FROM public.referral_transactions WHERE id = v_txn;
  SELECT total_coins_earned, successful_referrals INTO v_coins_before, v_succ_before
    FROM public.users WHERE id = v_ref;
  SELECT count(*) INTO v_wt_before FROM public.wallet_transactions WHERE user_id = v_ref;

  ALTER TABLE public.bookings DISABLE TRIGGER USER;
  ALTER TABLE public.bookings ENABLE TRIGGER trg_bookings_after_complete_referral;

  INSERT INTO public.bookings (user_id, service_duration_minutes, service_label, price, slot_type, status)
  VALUES (v_user, 60, 'REFERRAL TRIGGER TEST', 1, 'now', 'confirmed')
  RETURNING id INTO v_booking;

  UPDATE public.bookings SET status = 'completed' WHERE id = v_booking;
  -- idempotency: bounce back and complete again
  UPDATE public.bookings SET status = 'in_progress' WHERE id = v_booking;
  UPDATE public.bookings SET status = 'completed' WHERE id = v_booking;

  SELECT count(*) INTO v_wt_after FROM public.wallet_transactions WHERE user_id = v_ref;

  INSERT INTO public._referral_test_log(k, v)
  SELECT 'txn_status_after', status FROM public.referral_transactions WHERE id = v_txn
  UNION ALL SELECT 'booking_reward_amount', COALESCE(booking_reward_amount,0)::text FROM public.referral_transactions WHERE id = v_txn
  UNION ALL SELECT 'coins_before', v_coins_before::text
  UNION ALL SELECT 'coins_after', (SELECT total_coins_earned::text FROM public.users WHERE id = v_ref)
  UNION ALL SELECT 'successful_referrals_after', (SELECT successful_referrals::text FROM public.users WHERE id = v_ref)
  UNION ALL SELECT 'wallet_rows_added', (v_wt_after - v_wt_before)::text;

  -- ===== cleanup / restore =====
  DELETE FROM public.wallet_transactions
   WHERE user_id = v_ref AND description LIKE 'Referral%'
     AND created_at > now() - interval '2 minutes';

  DELETE FROM public.referral_milestone_awards WHERE user_id = v_ref AND created_at > now() - interval '2 minutes';

  UPDATE public.referral_transactions SET
    status = v_txn_before.status,
    reward_amount = v_txn_before.reward_amount,
    reward_date = v_txn_before.reward_date,
    booking_id = v_txn_before.booking_id,
    signup_reward_amount = v_txn_before.signup_reward_amount,
    signup_reward_date = v_txn_before.signup_reward_date,
    booking_reward_amount = v_txn_before.booking_reward_amount,
    booking_reward_date = v_txn_before.booking_reward_date
  WHERE id = v_txn;

  PERFORM set_config('app.users_bypass', 'on', true);
  UPDATE public.users SET total_coins_earned = v_coins_before, successful_referrals = v_succ_before
   WHERE id = v_ref;
  PERFORM set_config('app.users_bypass', 'off', true);

  DELETE FROM public.bookings WHERE id = v_booking;

  ALTER TABLE public.bookings ENABLE TRIGGER USER;
END $$;