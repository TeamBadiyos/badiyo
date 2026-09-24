CREATE OR REPLACE FUNCTION public.store_create_order(
  _merchant_id uuid,
  _items jsonb,
  _address_id uuid,
  _payment_mode text DEFAULT 'cod',
  _note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _m record; _addr record; _it jsonb; _p record;
  _qty int; _items_total numeric := 0; _fee numeric; _quote jsonb;
  _order_id uuid; _num text; _count int := 0;
  _phone text; _name text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'empty_cart');
  END IF;

  IF _payment_mode NOT IN ('cod', 'online') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_payment_mode');
  END IF;

  SELECT * INTO _m FROM public.public_stores WHERE id = _merchant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'store_unavailable');
  END IF;
  IF COALESCE(_m.is_open_now, false) = false OR COALESCE(_m.is_accepting_orders, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'store_closed');
  END IF;

  SELECT * INTO _addr FROM public.addresses WHERE id = _address_id AND user_id = _uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'bad_address');
  END IF;

  SELECT phone, full_name INTO _phone, _name FROM public.users WHERE id = _uid;

  _order_id := gen_random_uuid();
  _num := 'BS' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD')
          || lpad((floor(random() * 100000))::int::text, 5, '0');

  INSERT INTO public.merchant_orders (
    id, merchant_id, user_id, order_number, status, total_amount,
    address_id, delivery_address, delivery_lat, delivery_lng,
    customer_phone, customer_name, payment_mode, payment_status,
    items_total, delivery_fee, customer_note, source
  ) VALUES (
    _order_id, _merchant_id, _uid, _num, 'pending', 0,
    _address_id,
    NULLIF(btrim(concat_ws(', ', NULLIF(_addr.full_address,''), NULLIF(_addr.area,''), NULLIF(_addr.city,''))), ''),
    _addr.latitude, _addr.longitude,
    _phone, _name, _payment_mode,
    CASE WHEN _payment_mode = 'cod' THEN 'cod_pending' ELSE 'pending' END,
    0, 0, NULLIF(btrim(COALESCE(_note,'')), ''), 'customer_app'
  );

  FOR _it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _qty := GREATEST(1, LEAST(50, COALESCE((_it->>'quantity')::int, 1)));
    SELECT p.id, p.name, p.price, p.stock_quantity INTO _p
      FROM public.products p
      JOIN public.public_products pp ON pp.id = p.id
     WHERE p.id = (_it->>'product_id')::uuid
       AND p.merchant_id = _merchant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_unavailable';
    END IF;
    IF COALESCE(_p.stock_quantity, 0) < _qty THEN
      RAISE EXCEPTION 'out_of_stock';
    END IF;

    INSERT INTO public.merchant_order_items (order_id, product_id, product_name_snapshot, price_snapshot, quantity)
    VALUES (_order_id, _p.id, _p.name, _p.price, _qty);

    _items_total := _items_total + (_p.price * _qty);
    _count := _count + 1;
  END LOOP;

  IF _count = 0 THEN
    RAISE EXCEPTION 'empty_cart';
  END IF;

  IF _items_total < public.store_setting('store_min_order_amount', 0) THEN
    RAISE EXCEPTION 'below_min_order';
  END IF;

  _quote := public.store_delivery_quote(_items_total);
  _fee := (_quote->>'delivery_fee')::numeric;

  UPDATE public.merchant_orders
     SET items_total = _items_total,
         delivery_fee = _fee,
         total_amount = _items_total + _fee,
         updated_at = now()
   WHERE id = _order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', _order_id,
    'order_number', _num,
    'items_total', _items_total,
    'delivery_fee', _fee,
    'total_amount', _items_total + _fee,
    'payment_mode', _payment_mode
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'code', split_part(SQLERRM, ':', 1), 'detail', SQLERRM);
END $$;