-- 1) Extra columns the customer order flow needs.
ALTER TABLE public.merchant_orders
  ADD COLUMN IF NOT EXISTS address_id uuid REFERENCES public.addresses(id),
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_lat numeric,
  ADD COLUMN IF NOT EXISTS delivery_lng numeric,
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'cod',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS items_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_note text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'merchant_pos';

-- 2) Customers may read their own orders (merchant/staff policies untouched).
DROP POLICY IF EXISTS "Customers view own store orders" ON public.merchant_orders;
CREATE POLICY "Customers view own store orders"
  ON public.merchant_orders FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Customers view own store order items" ON public.merchant_order_items;
CREATE POLICY "Customers view own store order items"
  ON public.merchant_order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.merchant_orders o
     WHERE o.id = merchant_order_items.order_id AND o.user_id = auth.uid()
  ));

GRANT SELECT ON public.merchant_orders TO authenticated;
GRANT SELECT ON public.merchant_order_items TO authenticated;
GRANT ALL ON public.merchant_orders TO service_role;
GRANT ALL ON public.merchant_order_items TO service_role;

-- 3) Numeric ops setting helper for store delivery pricing (ops_settings is staff-only).
CREATE OR REPLACE FUNCTION public.store_setting(_key text, _default numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT NULLIF(value, '')::numeric FROM public.ops_settings WHERE key = _key), _default);
$$;
REVOKE ALL ON FUNCTION public.store_setting(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_setting(text, numeric) TO authenticated, service_role;

-- 4) Delivery-fee quote the client can show before checkout.
CREATE OR REPLACE FUNCTION public.store_delivery_quote(_items_total numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _fee numeric; _free_above numeric; _min numeric;
BEGIN
  _fee        := public.store_setting('store_delivery_fee', 25);
  _free_above := public.store_setting('store_free_delivery_above', 299);
  _min        := public.store_setting('store_min_order_amount', 0);
  IF _free_above > 0 AND COALESCE(_items_total,0) >= _free_above THEN _fee := 0; END IF;
  RETURN jsonb_build_object(
    'delivery_fee', _fee,
    'free_delivery_above', _free_above,
    'min_order_amount', _min,
    'total', COALESCE(_items_total,0) + _fee
  );
END $$;
REVOKE ALL ON FUNCTION public.store_delivery_quote(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_delivery_quote(numeric) TO authenticated, service_role;

-- 5) Order placement. Prices/stock/open-state are all re-checked server side.
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

  -- Store must be a live, approved, customer-visible store.
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

  SELECT phone, name INTO _phone, _name FROM public.users WHERE id = _uid;

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
      RAISE EXCEPTION 'product_unavailable:%', (_it->>'product_id');
    END IF;
    IF COALESCE(_p.stock_quantity, 0) < _qty THEN
      RAISE EXCEPTION 'out_of_stock:%', _p.name;
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
REVOKE ALL ON FUNCTION public.store_create_order(uuid, jsonb, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_create_order(uuid, jsonb, uuid, text, text) TO authenticated;

-- 6) Customer may cancel while the shop has not accepted yet.
CREATE OR REPLACE FUNCTION public.store_cancel_order(_order_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _o record;
BEGIN
  SELECT * INTO _o FROM public.merchant_orders WHERE id = _order_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF _o.status NOT IN ('pending', 'paid') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_late');
  END IF;
  UPDATE public.merchant_orders
     SET status = 'cancelled', cancelled_at = now(),
         cancel_reason = NULLIF(btrim(COALESCE(_reason,'')), ''), updated_at = now()
   WHERE id = _order_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.store_cancel_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_cancel_order(uuid, text) TO authenticated;

-- 7) Customer-safe order read (joins items without widening table grants).
CREATE OR REPLACE FUNCTION public.store_my_orders()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'payment_mode', o.payment_mode,
      'payment_status', o.payment_status,
      'items_total', o.items_total,
      'delivery_fee', o.delivery_fee,
      'total_amount', o.total_amount,
      'delivery_address', o.delivery_address,
      'created_at', o.created_at,
      'store_name', m.store_name,
      'store_photo_url', m.shop_photo_url,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', i.product_name_snapshot,
          'price', i.price_snapshot,
          'quantity', i.quantity))
        FROM public.merchant_order_items i WHERE i.order_id = o.id
      ), '[]'::jsonb)
    ) AS x
    FROM public.merchant_orders o
    JOIN public.merchants m ON m.id = o.merchant_id
    WHERE o.user_id = auth.uid()
    ORDER BY o.created_at DESC
    LIMIT 100
  ) s;
$$;
REVOKE ALL ON FUNCTION public.store_my_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_my_orders() TO authenticated;