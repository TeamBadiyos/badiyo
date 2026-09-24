ALTER TABLE public.merchant_orders
  ADD COLUMN IF NOT EXISTS razorpay_order_id text,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS merchant_orders_rzp_order_idx
  ON public.merchant_orders (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;

-- Customer links their pending order to the Razorpay order it is about to pay.
CREATE OR REPLACE FUNCTION public.store_attach_payment(_order_id uuid, _rzp_order_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _o record;
BEGIN
  SELECT * INTO _o FROM public.merchant_orders WHERE id = _order_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF COALESCE(_o.payment_status,'') = 'paid' THEN RETURN jsonb_build_object('ok', true); END IF;
  UPDATE public.merchant_orders
     SET razorpay_order_id = NULLIF(btrim(COALESCE(_rzp_order_id,'')), ''), updated_at = now()
   WHERE id = _order_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.store_attach_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_attach_payment(uuid, text) TO authenticated;

-- Customer confirms right after the payment sheet succeeds. Only works when the
-- Razorpay order was attached first, so a client cannot mark an arbitrary order paid.
CREATE OR REPLACE FUNCTION public.store_confirm_payment(
  _order_id uuid, _rzp_order_id text, _payment_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _o record;
BEGIN
  SELECT * INTO _o FROM public.merchant_orders WHERE id = _order_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF COALESCE(_o.payment_status,'') = 'paid' THEN RETURN jsonb_build_object('ok', true); END IF;
  IF _o.razorpay_order_id IS NULL OR _o.razorpay_order_id <> btrim(COALESCE(_rzp_order_id,'')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'order_mismatch');
  END IF;
  UPDATE public.merchant_orders
     SET payment_status = 'paid',
         razorpay_payment_id = NULLIF(btrim(COALESCE(_payment_id,'')), ''),
         paid_at = now(),
         status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END,
         updated_at = now()
   WHERE id = _order_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.store_confirm_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_confirm_payment(uuid, text, text) TO authenticated;

-- Webhook safety net (service role only): find the order by Razorpay order id.
CREATE OR REPLACE FUNCTION public.system_store_mark_paid(_rzp_order_id text, _payment_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.merchant_orders
   WHERE razorpay_order_id = btrim(COALESCE(_rzp_order_id,''));
  IF _id IS NULL THEN RETURN false; END IF;
  UPDATE public.merchant_orders
     SET payment_status = 'paid',
         razorpay_payment_id = COALESCE(razorpay_payment_id, NULLIF(btrim(COALESCE(_payment_id,'')), '')),
         paid_at = COALESCE(paid_at, now()),
         status = CASE WHEN status = 'pending' THEN 'paid' ELSE status END,
         updated_at = now()
   WHERE id = _id AND COALESCE(payment_status,'') <> 'paid';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.system_store_mark_paid(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_store_mark_paid(text, text) TO service_role;