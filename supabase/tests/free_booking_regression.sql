-- Transactional regression tests: every fixture is rolled back before returning.
DO $$
DECLARE
  _uid uuid := 'f164c5b2-988d-4ad7-9872-504efcf55d83';
  _address uuid := '2e9956fb-f1db-4a2a-80fe-84b397c9e202';
  _option uuid := 'e21a0c1a-4884-48b0-81dd-b9044f080132';
  _before numeric; _original numeric; _after numeric; _result jsonb; _again jsonb; _payload jsonb;
  _order text; _booking uuid; _q jsonb; _category uuid; _spends bigint;
BEGIN
  IF has_function_privilege('anon','public.app_create_booking_wallet(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous wallet booking must be denied';
  END IF;
  SELECT cash_balance+bonus_balance INTO _before FROM public.customer_wallets WHERE user_id=_uid;
  _original := _before;
  SELECT s.category_id INTO _category FROM public.service_price_options o JOIN public.services s ON s.id=o.service_id WHERE o.id=_option;
  -- Original incident: ₹149 - ₹50 coupon + 5% GST rounds to ₹104.
  BEGIN
    PERFORM set_config('request.jwt.claim.sub',_uid::text,true);
    PERFORM set_config('app.booking_bypass','on',true);
    PERFORM public.wallet_post(_uid,'bonus','bonus',1000,'regression_test',gen_random_uuid()::text,'Rollback-only test',now()+interval '1 day',NULL);
    SELECT cash_balance+bonus_balance INTO _before FROM public.customer_wallets WHERE user_id=_uid;
    _payload:=jsonb_build_object('request_id',gen_random_uuid(),'address_id',_address,'price_option_id',_option,
      'slot_type','scheduled','scheduled_date',((now() AT TIME ZONE 'Asia/Kolkata')::date+1),
      'scheduled_time_slot','10:00 AM (10:00 AM – 11:00 AM)','coupon_code','NEW50','customer_note',repeat('a',301));
    _result:=public.app_create_booking_wallet(_payload);
    IF (_result->>'total_amount')::numeric IS DISTINCT FROM 104 THEN RAISE EXCEPTION 'Expected coupon-adjusted total ₹104: %',_result; END IF;
    SELECT cash_balance+bonus_balance INTO _after FROM public.customer_wallets WHERE user_id=_uid;
    IF _before-_after IS DISTINCT FROM 104 THEN RAISE EXCEPTION 'Expected exactly one ₹104 debit'; END IF;
    _again:=public.app_create_booking_wallet(_payload);
    IF _again->>'booking_id' IS DISTINCT FROM _result->>'booking_id' THEN RAISE EXCEPTION 'Retry created another booking'; END IF;
    IF (SELECT cash_balance+bonus_balance FROM public.customer_wallets WHERE user_id=_uid) IS DISTINCT FROM _after THEN RAISE EXCEPTION 'Retry debited wallet twice'; END IF;
    IF (SELECT length(customer_note) FROM public.bookings WHERE id=(_result->>'booking_id')::uuid) IS DISTINCT FROM 300 THEN RAISE EXCEPTION 'Note exceeds 300 characters'; END IF;
    RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='rollback successful wallet test';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
  BEGIN
    PERFORM set_config('app.booking_bypass','on',true);
    PERFORM public.wallet_post(_uid,'bonus','bonus',1000,'regression_test',gen_random_uuid()::text,'Rollback-only test',now()+interval '1 day',NULL);
    SELECT cash_balance+bonus_balance INTO _before FROM public.customer_wallets WHERE user_id=_uid;
    _order:='free_'||gen_random_uuid()::text;
    _q:=public.system_coupon_reserve(_uid,'NEW50',149,60,_order,_category);
    IF (_q->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Coupon fixture unavailable: %',_q; END IF;
    IF public.system_coins_reserve(_uid,_order,104)<>104 THEN RAISE EXCEPTION 'Expected ₹104 reservation'; END IF;
    INSERT INTO public.bookings(user_id,address_id,price_option_id,slot_type,scheduled_date,scheduled_time_slot,razorpay_order_id,razorpay_payment_id)
      VALUES(_uid,_address,_option,'scheduled',(now() AT TIME ZONE 'Asia/Kolkata')::date+1,'10:00 AM (10:00 AM – 11:00 AM)',_order,_order) RETURNING id INTO _booking;
    SELECT cash_balance+bonus_balance INTO _after FROM public.customer_wallets WHERE user_id=_uid;
    IF _before-_after IS DISTINCT FROM 104 THEN RAISE EXCEPTION 'Legacy free booking double debit'; END IF;
    IF (SELECT status FROM public.coin_redemptions WHERE razorpay_order_id=_order) IS DISTINCT FROM 'used' THEN RAISE EXCEPTION 'Reservation not consumed'; END IF;
    SELECT -sum(amount) INTO _spends FROM public.customer_wallet_ledger WHERE user_id=_uid AND ref_type='booking' AND ref_id=_booking::text AND type='payment';
    IF _spends IS DISTINCT FROM 104 THEN RAISE EXCEPTION 'Reserved payment not linked for refunds'; END IF;
    RAISE EXCEPTION USING ERRCODE='Z0001',MESSAGE='rollback successful legacy test';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
  IF (SELECT cash_balance+bonus_balance FROM public.customer_wallets WHERE user_id=_uid) IS DISTINCT FROM _original THEN RAISE EXCEPTION 'Tests changed real wallet balance'; END IF;
END $$;