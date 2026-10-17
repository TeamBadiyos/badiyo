CREATE OR REPLACE FUNCTION public.bookings_coin_debit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE _need numeric; _r public.coin_redemptions%ROWTYPE;
BEGIN
 IF COALESCE(NEW.is_training,false) OR NEW.user_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.razorpay_payment_id IS NULL OR NEW.razorpay_payment_id NOT LIKE 'free\_%' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.razorpay_payment_id IS NOT DISTINCT FROM NEW.razorpay_payment_id THEN RETURN NEW; END IF;
 _need := round(GREATEST(COALESCE(NEW.total_amount,0),0),2);
 SELECT * INTO _r FROM public.coin_redemptions WHERE razorpay_order_id=NEW.razorpay_order_id FOR UPDATE;
 IF FOUND THEN
   IF _r.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'WALLET_RESERVATION_OWNER_MISMATCH'; END IF;
   IF _r.status NOT IN ('reserved','used') THEN RAISE EXCEPTION 'WALLET_RESERVATION_NOT_ACTIVE'; END IF;
   IF _r.coins <> _need THEN RAISE EXCEPTION 'WALLET_RESERVATION_AMOUNT_MISMATCH'; END IF;
   -- The reservation has already spent the money. Link its original ledger
   -- entries to this booking so the existing refund split sees cash and bonus.
   UPDATE public.customer_wallet_ledger SET ref_type='booking',ref_id=NEW.id::text
     WHERE user_id=NEW.user_id AND ref_type='coin_reserve' AND ref_id=NEW.razorpay_order_id AND type='payment';
   UPDATE public.coin_redemptions SET status='used',updated_at=now() WHERE id=_r.id;
   RETURN NEW;
 END IF;
 IF _need <= 0 THEN RETURN NEW; END IF;
 -- Compatibility for older free orders without a reservation. Atomic insert
 -- and the unique order key prevent a second charge on retry.
 IF EXISTS (SELECT 1 FROM public.coin_redemptions WHERE razorpay_order_id='booking:'||NEW.id::text) THEN RETURN NEW; END IF;
 PERFORM public.wallet_spend(NEW.user_id,_need,'payment','booking',NEW.id::text,'Paid for booking '||coalesce(NEW.booking_number,'#'||left(NEW.id::text,6)));
 INSERT INTO public.coin_redemptions(user_id,razorpay_order_id,coins,status) VALUES(NEW.user_id,NEW.razorpay_order_id,ceil(_need)::int,'used');
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.app_create_booking_wallet(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE _uid uuid:=auth.uid(); _id uuid; _request uuid; _order text; _city uuid; _address uuid; _option uuid;
 _category uuid; _price numeric; _minutes integer; _code text; _q jsonb; b public.bookings%ROWTYPE;
 _spend jsonb; _c numeric:=0; _bn numeric:=0; _inv uuid; _old_bypass text;
BEGIN
 IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
 _request:=coalesce(nullif(_payload->>'request_id','')::uuid,gen_random_uuid());
 _order:='wallet_'||_request::text;
 PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text||':'||_order,0));
 SELECT * INTO b FROM public.bookings WHERE user_id=_uid AND razorpay_order_id=_order;
 IF FOUND THEN
   SELECT id INTO _inv FROM public.customer_invoices WHERE ref_type='booking' AND ref_id=b.id;
   SELECT coalesce(-sum(amount) FILTER(WHERE bucket='cash'),0),coalesce(-sum(amount) FILTER(WHERE bucket='bonus'),0)
     INTO _c,_bn FROM public.customer_wallet_ledger WHERE user_id=_uid AND ref_type='booking' AND ref_id=b.id::text AND type='payment';
   RETURN jsonb_build_object('ok',true,'booking_id',b.id,'booking_number',b.booking_number,'status',b.status,'total_amount',b.total_amount,'from_cash',_c,'from_bonus',_bn,'invoice_id',_inv);
 END IF;
 _address:=nullif(_payload->>'address_id','')::uuid;
 SELECT city_id INTO _city FROM public.addresses WHERE id=_address AND user_id=_uid;
 IF NOT FOUND THEN RAISE EXCEPTION 'ADDRESS_NOT_FOUND'; END IF;
 _city:=coalesce(_city,nullif(_payload->>'city_id','')::uuid);
 _option:=nullif(_payload->>'price_option_id','')::uuid;
 SELECT s.category_id,coalesce(o.estimated_minutes,o.duration_minutes),(public.city_opt(o.id,_city)).customer_price
   INTO _category,_minutes,_price FROM public.service_price_options o JOIN public.services s ON s.id=o.service_id
   WHERE o.id=_option AND o.is_active AND s.is_active AND coalesce((public.city_opt(o.id,_city)).is_active,false);
 IF NOT FOUND OR _price IS NULL THEN RAISE EXCEPTION 'SERVICE_OPTION_NOT_AVAILABLE'; END IF;
 -- Lock the customer's wallet across coupon validation, booking and payment.
 INSERT INTO public.customer_wallets(user_id) VALUES(_uid) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.customer_wallets WHERE user_id=_uid FOR UPDATE;
 _code:=nullif(upper(btrim(coalesce(_payload->>'coupon_code',''))),'');
 IF _code IS NOT NULL THEN
   _q:=public.system_coupon_reserve(_uid,_code,_price,_minutes,_order,_category);
   IF coalesce((_q->>'ok')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'COUPON_NOT_AVAILABLE'; END IF;
 END IF;
 INSERT INTO public.bookings(user_id,address_id,price_option_id,service_category_id,service_label,slot_type,
   scheduled_date,scheduled_time_slot,booking_lat,booking_lng,city_id,razorpay_order_id,customer_note)
 VALUES(_uid,_address,_option,_category,_payload->>'service_label',coalesce(_payload->>'slot_type','scheduled'),
   nullif(_payload->>'scheduled_date','')::date,nullif(_payload->>'scheduled_time_slot',''),
   nullif(_payload->>'booking_lat','')::numeric,nullif(_payload->>'booking_lng','')::numeric,_city,_order,
   left(nullif(btrim(_payload->>'customer_note'),''),300)) RETURNING * INTO b;
 _id:=b.id;
 IF b.total_amount>0 THEN
   IF (SELECT cash_balance+bonus_balance FROM public.customer_wallets WHERE user_id=_uid)<b.total_amount THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
   _spend:=public.wallet_spend(_uid,b.total_amount,'payment','booking',_id::text,'Payment');
   _c:=(_spend->>'cash')::numeric; _bn:=(_spend->>'bonus')::numeric;
 END IF;
 _old_bypass:=current_setting('app.booking_bypass',true);
 PERFORM set_config('app.booking_bypass','on',true);
 UPDATE public.bookings SET razorpay_payment_id=_order WHERE id=_id;
 PERFORM set_config('app.booking_bypass',coalesce(_old_bypass,'off'),true);
 SELECT id INTO _inv FROM public.customer_invoices WHERE ref_type='booking' AND ref_id=_id;
 IF _inv IS NULL THEN _inv:=public.fin_issue_invoice('booking',_id); END IF;
 SELECT * INTO b FROM public.bookings WHERE id=_id;
 RETURN jsonb_build_object('ok',true,'booking_id',_id,'booking_number',b.booking_number,'status',b.status,
   'total_amount',b.total_amount,'from_cash',_c,'from_bonus',_bn,'invoice_id',_inv);
END $$;
REVOKE ALL ON FUNCTION public.app_create_booking_wallet(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.app_create_booking_wallet(jsonb) TO authenticated,service_role;
-- The payment service calls this rate helper directly; no public privilege expansion.
GRANT EXECUTE ON FUNCTION public.booking_gst_percent(uuid) TO service_role;
