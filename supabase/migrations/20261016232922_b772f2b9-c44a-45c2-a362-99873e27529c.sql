ALTER TABLE public.merchant_orders
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_used numeric NOT NULL DEFAULT 0;

-- Coupon/wallet bookkeeping on payment and cancellation.
CREATE OR REPLACE FUNCTION public.merchant_orders_promo_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _cid uuid; n int;
BEGIN
  IF NEW.payment_status = 'paid' AND coalesce(OLD.payment_status,'') <> 'paid' AND coalesce(NEW.coupon_discount,0) > 0 THEN
    UPDATE coupon_redemptions SET status='applied', updated_at=now()
     WHERE razorpay_order_id = 'store_'||NEW.id::text AND user_id = NEW.user_id AND status IN ('reserved','released')
     RETURNING coupon_id INTO _cid;
    IF _cid IS NOT NULL THEN
      UPDATE coupons SET used_count = coalesce(used_count,0)+1 WHERE id=_cid;
      UPDATE customer_coupons SET status='used', used_at=now() WHERE coupon_id=_cid AND user_id=NEW.user_id AND status='available';
    END IF;
  END IF;
  IF NEW.status IN ('cancelled','rejected') AND coalesce(OLD.status,'') NOT IN ('cancelled','rejected') THEN
    IF coalesce(NEW.wallet_used,0) > 0 THEN
      PERFORM wallet_return(NEW.user_id, 'merchant_order', NEW.id::text, 'Shop order refund · to badiyos Wallet');
    END IF;
    UPDATE coupon_redemptions SET status='released', updated_at=now()
     WHERE razorpay_order_id = 'store_'||NEW.id::text AND user_id = NEW.user_id AND status IN ('reserved','applied')
     RETURNING coupon_id INTO _cid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 AND _cid IS NOT NULL AND coalesce(OLD.payment_status,'') IN ('paid','refund_pending','refunded') THEN
      UPDATE coupons SET used_count = greatest(coalesce(used_count,0)-1,0) WHERE id=_cid;
      UPDATE customer_coupons SET status='available', used_at=NULL WHERE coupon_id=_cid AND user_id=NEW.user_id AND status='used';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS merchant_orders_promo_sync ON public.merchant_orders;
CREATE TRIGGER merchant_orders_promo_sync AFTER UPDATE OF status, payment_status ON public.merchant_orders
  FOR EACH ROW EXECUTE FUNCTION public.merchant_orders_promo_sync();

-- Refunds: give wallet part back; nothing to refund on the card when it paid ₹0.
CREATE OR REPLACE FUNCTION public.store_mark_refund(_order_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare _o record;
begin
  select id, user_id, total_amount, wallet_used into _o from public.merchant_orders
   where id = _order_id and payment_status = 'paid' and coalesce(refund_status,'none') in ('none');
  if not found then return; end if;
  if coalesce(_o.wallet_used,0) > 0 then
    perform public.wallet_return(_o.user_id, 'merchant_order', _o.id::text, 'Shop order refund · to badiyos Wallet');
  end if;
  if coalesce(_o.total_amount,0) <= 0 then
    update public.merchant_orders set refund_status = 'done', refund_amount = 0, refund_reason = _reason,
           payment_status = 'refunded', refunded_at = now(), updated_at = now() where id = _order_id;
    perform public.store_audit(_order_id, 'store_refund_wallet_only', null, jsonb_build_object('reason', _reason));
    return;
  end if;
  update public.merchant_orders
     set refund_status = 'refund_pending', refund_amount = total_amount, refund_reason = _reason,
         refund_next_attempt_at = now(), payment_status = 'refund_pending', updated_at = now()
   where id = _order_id;
  perform public.store_audit(_order_id, 'store_refund_requested', null, jsonb_build_object('reason', _reason));
  perform public.store_dispatch_refund_job();
end $function$;

-- Checkout quote for the shared Checkout.
CREATE OR REPLACE FUNCTION public.store_checkout_quote(_merchant_id uuid, _items jsonb, _address_id uuid,
  _coupon_code text DEFAULT NULL, _use_wallet boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _a record; _bill jsonb; _f jsonb; _gross numeric; _items_total numeric;
  _save numeric := 0; _q jsonb; _disc numeric := 0; _bal numeric := 0; _w numeric := 0; _l jsonb; _p record;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok',false,'code','unauthenticated'); END IF;
  SELECT latitude, longitude INTO _a FROM addresses WHERE id=_address_id AND user_id=_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','bad_address'); END IF;
  BEGIN
    _bill := order_bill_core(_merchant_id, _items, _a.latitude, _a.longitude);
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok',false,'code',split_part(sqlerrm,':',1));
  END;
  _f := _bill->'full';
  _items_total := (_f->>'item_total')::numeric; _gross := (_f->>'total_payable')::numeric;
  FOR _l IN SELECT * FROM jsonb_array_elements(_bill->'lines') LOOP
    SELECT price, original_price INTO _p FROM products WHERE id=(_l->>'product_id')::uuid;
    IF _l->>'variant_id' IS NULL AND _p.original_price > _p.price THEN
      _save := _save + (_p.original_price - _p.price) * (_l->>'qty')::int;
    END IF;
  END LOOP;
  IF nullif(btrim(coalesce(_coupon_code,'')),'') IS NOT NULL THEN
    _q := coupon_quote(_uid, _coupon_code, _items_total, NULL, NULL);
    IF (_q->>'ok')::boolean THEN _disc := least((_q->>'discount')::numeric, _gross); END IF;
  END IF;
  SELECT coalesce(cash_balance,0)+coalesce(bonus_balance,0) INTO _bal FROM customer_wallets WHERE user_id=_uid;
  _bal := coalesce(_bal,0);
  IF _use_wallet THEN _w := least(_bal, _gross - _disc); END IF;
  RETURN jsonb_build_object('ok',true,'item_total',_items_total,
    'delivery_fee',coalesce((_f->>'delivery_fee')::numeric,0),
    'gst_items',coalesce((_f->>'gst_items')::numeric,0),'gst_delivery',coalesce((_f->>'gst_delivery')::numeric,0),
    'platform_fee',coalesce((_f->>'platform_fee')::numeric,0),'gst_platform',coalesce((_f->>'gst_platform')::numeric,0),
    'gross_total',_gross,'you_save',_save,'coupon',_q,'coupon_discount',_disc,
    'wallet_balance',_bal,'wallet_used',_w,'to_pay',_gross - _disc - _w);
END $$;

-- Place a shop order with optional coupon and wallet.
CREATE OR REPLACE FUNCTION public.store_place_order(_merchant_id uuid, _items jsonb, _address_id uuid,
  _note text DEFAULT NULL, _coupon_code text DEFAULT NULL, _use_wallet boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); r jsonb; _id uuid; _o record; _gross numeric; _q jsonb; _disc numeric := 0;
  _w numeric := 0; _ws jsonb; _code text := nullif(btrim(coalesce(_coupon_code,'')),''); _paid boolean := false;
BEGIN
  r := store_create_order(_merchant_id, _items, _address_id, 'online', _note);
  IF (r->>'ok')::boolean IS NOT TRUE THEN RETURN r; END IF;
  _id := (r->>'order_id')::uuid;
  SELECT * INTO _o FROM merchant_orders WHERE id=_id AND user_id=_uid FOR UPDATE;
  IF coalesce(_o.wallet_used,0) > 0 THEN
    PERFORM wallet_return(_uid,'merchant_order',_id::text,'Checkout changed');
  END IF;
  PERFORM system_coupon_release('store_'||_id::text);
  _gross := coalesce(_o.total_payable, _o.total_amount);
  IF _code IS NOT NULL THEN
    _q := system_coupon_reserve(_uid, _code, _o.items_total, NULL, 'store_'||_id::text, NULL);
    IF (_q->>'ok')::boolean IS NOT TRUE THEN
      UPDATE merchant_orders SET cancel_reason='COUPON_INVALID' WHERE id=_id;
      PERFORM store_set_status(_id,'cancelled','store_coupon_invalid');
      RETURN jsonb_build_object('ok',false,'code','coupon_invalid','reason',_q->>'reason');
    END IF;
    _disc := least((_q->>'discount')::numeric, _gross);
  END IF;
  IF _use_wallet AND _gross - _disc > 0 THEN
    _ws := wallet_spend(_uid, _gross - _disc, 'payment', 'merchant_order', _id::text, 'Shop order', false, true);
    _w := coalesce((_ws->>'cash')::numeric,0) + coalesce((_ws->>'bonus')::numeric,0);
  END IF;
  UPDATE merchant_orders SET coupon_code = CASE WHEN _disc > 0 THEN upper(_code) END, coupon_discount=_disc,
         wallet_used=_w, total_amount = round(_gross - _disc - _w, 2), updated_at=now() WHERE id=_id;
  IF round(_gross - _disc - _w, 2) <= 0 THEN
    UPDATE merchant_orders SET razorpay_order_id='wallet_'||_id::text WHERE id=_id;
    PERFORM system_store_mark_paid('wallet_'||_id::text, 'wallet_'||_id::text);
    _paid := true;
  END IF;
  RETURN r || jsonb_build_object('gross_total',_gross,'coupon_discount',_disc,'wallet_used',_w,
    'total_amount', round(_gross - _disc - _w, 2), 'paid', _paid);
END $$;

-- Public search across stores and items of one tab.
CREATE OR REPLACE FUNCTION public.app_commerce_search(_service_key text, _city_id uuid, _q text,
  _lat double precision DEFAULT NULL, _lng double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _svc text := CASE WHEN _service_key='food' THEN 'food' ELSE 'store' END;
  _w text[]; _stores jsonb; _groups jsonb;
BEGIN
  _w := array(SELECT x FROM unnest(regexp_split_to_array(lower(btrim(coalesce(_q,''))), '\s+')) x WHERE length(x) > 0);
  IF cardinality(_w) = 0 OR length(btrim(_q)) < 2 THEN RETURN jsonb_build_object('stores','[]'::jsonb,'item_groups','[]'::jsonb); END IF;
  WITH ms AS (
    SELECT m.id, lower(concat_ws(' ', m.store_name, sc.name, sc.name_mr, m.offer_text)) hay FROM merchants m
      LEFT JOIN store_categories sc ON sc.id=m.store_category_id
     WHERE m.deleted_at IS NULL AND m.status='approved' AND coalesce(m.store_enabled,true)
       AND coalesce(m.service_type,'store')=_svc AND (_city_id IS NULL OR m.city_id=_city_id))
  SELECT coalesce(jsonb_agg(c ORDER BY (c->>'is_open')::boolean DESC, (c->>'distance_km')::numeric NULLS LAST),'[]') INTO _stores
    FROM (SELECT app_store_card(ms.id,_lat,_lng) c FROM ms
           WHERE (SELECT bool_and(ms.hay LIKE '%'||w||'%') FROM unnest(_w) w) LIMIT 20) z;
  WITH it AS (
    SELECT p.id, p.merchant_id FROM products p JOIN merchants m ON m.id=p.merchant_id
      LEFT JOIN catalog_categories cc ON cc.id=p.category_id
     WHERE m.deleted_at IS NULL AND m.status='approved' AND coalesce(m.store_enabled,true)
       AND coalesce(m.service_type,'store')=_svc AND (_city_id IS NULL OR m.city_id=_city_id)
       AND p.approval_status='approved' AND coalesce(p.is_active,true) AND NOT coalesce(p.admin_hidden,false)
       AND (SELECT bool_and(lower(concat_ws(' ', p.name, p.category_label, cc.name)) LIKE '%'||w||'%') FROM unnest(_w) w)
     LIMIT 60),
  g AS (
    SELECT app_store_card(it.merchant_id,_lat,_lng) store,
           jsonb_agg(app_item_card(it.id) ORDER BY app_item_card(it.id)->>'name') items
      FROM it GROUP BY it.merchant_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('store',store,'items',items)
           ORDER BY (store->>'is_open')::boolean DESC, (store->>'distance_km')::numeric NULLS LAST),'[]') INTO _groups FROM g;
  RETURN jsonb_build_object('stores',_stores,'item_groups',_groups);
END $$;

REVOKE ALL ON FUNCTION public.store_checkout_quote(uuid,jsonb,uuid,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.store_place_order(uuid,jsonb,uuid,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_checkout_quote(uuid,jsonb,uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_place_order(uuid,jsonb,uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_commerce_search(text,uuid,text,double precision,double precision) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.merchant_orders_promo_sync() FROM PUBLIC, anon, authenticated;